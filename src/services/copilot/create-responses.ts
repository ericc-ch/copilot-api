import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "./create-chat-completions"

export const createResponsesFromChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(toResponsesPayload(payload)),
  })

  if (!response.ok) {
    throw new HTTPError("Failed to create response", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponseApiResponse
}

export const shouldUseResponsesEndpoint = (endpoints?: Array<string>) =>
  endpoints ?
    endpoints.includes("/responses") && !endpoints.includes("/chat/completions")
  : false

export function responseToChatCompletion(
  response: ResponseApiResponse,
): ChatCompletionResponse {
  const toolCalls = getResponseToolCalls(response)
  const text = getResponseText(response)

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          // Chat Completions convention: content is null when the turn is
          // purely tool calls.
          content: text || (toolCalls.length > 0 ? null : ""),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: nonStreamFinishReason(response, toolCalls.length > 0),
      },
    ],
    usage: toChatUsage(response.usage),
  }
}

function nonStreamFinishReason(
  response: ResponseApiResponse,
  hasToolCalls: boolean,
): "stop" | "length" | "tool_calls" {
  if (hasToolCalls) return "tool_calls"
  return response.status === "completed" ? "stop" : "length"
}

function getResponseToolCalls(response: ResponseApiResponse): Array<ToolCall> {
  return (
    response.output
      ?.filter((item) => item.type === "function_call")
      .map((item) => ({
        id: item.call_id ?? item.id ?? "",
        type: "function" as const,
        function: {
          name: item.name ?? "",
          arguments: item.arguments ?? "",
        },
      })) ?? []
  )
}

type ChatChunkDelta = ChatCompletionChunk["choices"][number]["delta"]
type ChatChunkFinish = ChatCompletionChunk["choices"][number]["finish_reason"]

interface ChunkParts {
  delta: ChatChunkDelta
  finishReason: ChatChunkFinish
  usage?: ChatCompletionChunk["usage"]
}

function buildChunk(
  state: ResponsesStreamState,
  { delta, finishReason, usage }: ChunkParts,
): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    ...(usage && { usage }),
  }
}

function consumeRole(state: ResponsesStreamState): "assistant" | undefined {
  const role = state.roleSent ? undefined : "assistant"
  state.roleSent = true
  return role
}

function handleTextDelta(
  event: ResponseStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk | "[DONE]"> {
  if (!event.delta) return []
  return [
    buildChunk(state, {
      delta: { role: consumeRole(state), content: event.delta },
      finishReason: null,
    }),
  ]
}

function handleFunctionCallAdded(
  event: ResponseStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk | "[DONE]"> {
  if (event.item?.type !== "function_call") return []

  state.toolCalls ??= {}
  const index = state.toolCallCount ?? 0
  state.toolCallCount = index + 1
  state.hasToolCalls = true
  state.toolCalls[event.item.id ?? event.item_id ?? String(index)] = { index }

  return [
    buildChunk(state, {
      delta: {
        role: consumeRole(state),
        tool_calls: [
          {
            index,
            id: event.item.call_id ?? event.item.id ?? "",
            type: "function",
            function: { name: event.item.name ?? "", arguments: "" },
          },
        ],
      },
      finishReason: null,
    }),
  ]
}

function handleFunctionCallArgsDelta(
  event: ResponseStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk | "[DONE]"> {
  if (!event.item_id || !event.delta) return []
  const toolCall = state.toolCalls?.[event.item_id]
  if (!toolCall) return []

  return [
    buildChunk(state, {
      delta: {
        tool_calls: [
          { index: toolCall.index, function: { arguments: event.delta } },
        ],
      },
      finishReason: null,
    }),
  ]
}

function handleCompleted(
  event: ResponseStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk | "[DONE]"> {
  if (!event.response) return []
  state.id = event.response.id
  state.model = event.response.model
  state.created = event.response.created_at
  state.roleSent = true

  return [
    buildChunk(state, {
      delta: { content: null },
      finishReason: state.hasToolCalls ? "tool_calls" : "stop",
      usage: toChatUsage(event.response.usage),
    }),
    "[DONE]",
  ]
}

export function responseEventToChatChunks(
  eventData: string,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk | "[DONE]"> {
  let event: ResponseStreamEvent
  try {
    event = JSON.parse(eventData) as ResponseStreamEvent
  } catch {
    // Skip malformed or non-JSON SSE events (e.g. keepalives)
    // instead of killing the whole stream.
    consola.debug("Skipping non-JSON responses stream event:", eventData)
    return []
  }

  if (event.type === "response.created" && event.response) {
    state.id = event.response.id
    state.model = event.response.model
    state.created = event.response.created_at
    return []
  }

  switch (event.type) {
    case "response.output_text.delta": {
      return handleTextDelta(event, state)
    }
    case "response.output_item.added": {
      return handleFunctionCallAdded(event, state)
    }
    case "response.function_call_arguments.delta": {
      return handleFunctionCallArgsDelta(event, state)
    }
    case "response.completed": {
      return handleCompleted(event, state)
    }
    default: {
      return []
    }
  }
}

export interface ResponsesStreamState {
  created: number
  id: string
  model: string
  roleSent: boolean
  // Maps a streamed function_call item id to its chat-completions tool_calls
  // array index. Lazily initialized so existing construction sites still work.
  toolCalls?: Record<string, { index: number }>
  toolCallCount?: number
  hasToolCalls?: boolean
}

interface ResponsesPayload {
  input: Array<ResponseInputItem>
  max_output_tokens?: number | null
  model: string
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  tools?: Array<ResponsesFunctionTool>
  tool_choice?: ResponsesToolChoice
}

interface ResponseInputMessage {
  type?: "message"
  content: string
  role: "assistant" | "developer" | "system" | "user"
}

interface ResponseFunctionCallInput {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

interface ResponseFunctionCallOutputInput {
  type: "function_call_output"
  call_id: string
  output: string
}

type ResponseInputItem =
  | ResponseInputMessage
  | ResponseFunctionCallInput
  | ResponseFunctionCallOutputInput

interface ResponsesFunctionTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

type ResponsesToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string }

export interface ResponseApiResponse {
  created_at: number
  error?: unknown
  id: string
  model: string
  object: "response"
  output?: Array<ResponseOutputItem>
  status: string
  usage?: ResponseUsage | null
}

interface ResponseOutputItem {
  type?: string
  content?: Array<ResponseContentPart>
  // Present when type === "function_call"
  id?: string
  call_id?: string
  name?: string
  arguments?: string
}

interface ResponseContentPart {
  text?: string
  type: string
}

interface ResponseUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

interface ResponseStreamEvent {
  delta?: string
  response?: ResponseApiResponse
  type: string
  // Function-call streaming fields
  item?: ResponseOutputItem
  item_id?: string
  output_index?: number
}

export function toResponsesPayload(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  return {
    model: payload.model,
    input: payload.messages.flatMap((message) => toResponseInputItems(message)),
    max_output_tokens: payload.max_tokens,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    tools: toResponsesTools(payload.tools),
    tool_choice: toResponsesToolChoice(payload.tool_choice),
  }
}

function toResponsesTools(
  tools: ChatCompletionsPayload["tools"],
): Array<ResponsesFunctionTool> | undefined {
  if (!tools || tools.length === 0) return undefined
  // Chat Completions nests the function under `function`; the Responses API
  // expects the name/description/parameters flattened onto the tool itself.
  return tools.map((tool: Tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

function toResponsesToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ResponsesToolChoice | undefined {
  if (toolChoice === null || toolChoice === undefined) return undefined
  if (typeof toolChoice === "string") return toolChoice
  return { type: "function", name: toolChoice.function.name }
}

function toResponseInputItems(message: Message): Array<ResponseInputItem> {
  // A tool result becomes a function_call_output keyed by its call id.
  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: contentToText(message.content),
      },
    ]
  }

  // An assistant turn that issued tool calls becomes optional text followed by
  // one function_call item per call.
  if (
    message.role === "assistant"
    && message.tool_calls
    && message.tool_calls.length > 0
  ) {
    const items: Array<ResponseInputItem> = []
    const text = contentToText(message.content)
    if (text) {
      items.push({ type: "message", role: "assistant", content: text })
    }
    for (const toolCall of message.tool_calls) {
      items.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })
    }
    return items
  }

  return [
    {
      type: "message",
      role: message.role,
      content: contentToText(message.content),
    },
  ]
}

function contentToText(content: Message["content"]): string {
  if (typeof content === "string") return content
  if (!content) return ""

  return content.map((part) => contentPartToText(part)).join("\n")
}

function contentPartToText(part: ContentPart): string {
  if (part.type === "text") return part.text

  return `[image: ${part.image_url.url}]`
}

function getResponseText(response: ResponseApiResponse): string {
  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("") ?? ""
  )
}

function toChatUsage(usage?: ResponseUsage | null) {
  if (!usage) return undefined

  return {
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  }
}
