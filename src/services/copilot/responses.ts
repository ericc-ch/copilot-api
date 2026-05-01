import { randomUUID } from "node:crypto"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
} from "./create-chat-completions"

import { sanitizeUserIdentifier } from "./create-chat-completions"

export interface ResponseStreamEventMessage {
  data?: string
  event?: string
}

export interface ResponsesApiResponse {
  id: string
  created_at: number
  model: string
  output: Array<ResponsesOutputItem>
  usage?: {
    input_tokens: number
    input_tokens_details?: {
      cached_tokens?: number
    }
    output_tokens: number
    output_tokens_details?: {
      reasoning_tokens?: number
    }
    total_tokens: number
  }
  incomplete_details?: {
    reason?: string | null
  } | null
}

export type ResponsesReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "max"
  | "xhigh"

type ResponsesInput = string | Array<ResponsesInputItem>

type ResponsesInputItem =
  | ResponsesMessageInput
  | ResponsesFunctionCallInput
  | ResponsesFunctionCallOutputInput

type ResponsesMessageInput = {
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponsesInputContentPart>
}

type ResponsesInputContentPart =
  | {
      type: "input_text"
      text: string
    }
  | {
      type: "input_image"
      image_url: string
      detail: "low" | "high" | "auto"
    }

type ResponsesFunctionCallInput = {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

type ResponsesFunctionCallOutputInput = {
  type: "function_call_output"
  call_id: string
  output: string
}

type ResponsesToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name: string }

export interface ResponsesRequestPayload {
  model: string
  input: ResponsesInput
  stream?: boolean | null
  max_output_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  user?: string | null
  reasoning?: {
    effort: ResponsesReasoningEffort
  }
  tools?: Array<ResponsesTool>
  tool_choice?: ResponsesToolChoice | null
  text?: {
    format: {
      type: "json_object"
    }
  }
}

interface ResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

type ResponsesOutputItem =
  | ResponsesMessageOutputItem
  | ResponsesFunctionCallOutputItem
  | ResponsesReasoningOutputItem

interface ResponsesMessageOutputItem {
  type: "message"
  role: "assistant"
  content: Array<ResponsesMessageContentPart>
}

interface ResponsesMessageContentPart {
  type: "output_text"
  text: string
}

interface ResponsesFunctionCallOutputItem {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

interface ResponsesReasoningOutputItem {
  type: "reasoning"
}

interface ResponsesStreamEnvelope {
  type: string
  response?: {
    id: string
    created_at: number
    model: string
    usage?: ResponsesApiResponse["usage"]
    output?: Array<ResponsesOutputItem>
    incomplete_details?: ResponsesApiResponse["incomplete_details"]
  }
  item?:
    | Partial<ResponsesMessageOutputItem>
    | Partial<ResponsesFunctionCallOutputItem>
  output_index?: number
  delta?: string
}

interface ResponseTranslationState {
  responseId: string
  createdAt: number
  model: string
  started: boolean
}

interface CreateChunkOptions {
  delta: ChatCompletionChunk["choices"][0]["delta"]
  finishReason?: ChatCompletionChunk["choices"][0]["finish_reason"]
  usage?: ChatCompletionChunk["usage"]
}

const RESPONSES_ONLY_MODEL_PATTERN = /^(?:gpt-5\.3-codex|gpt-5\.4-mini)(?:-|$)/i

export function shouldUseResponsesApiForModel(model: string): boolean {
  return RESPONSES_ONLY_MODEL_PATTERN.test(model)
}

export function buildResponsesRequestPayload(
  payload: ChatCompletionsPayload,
  reasoningEffort: ResponsesReasoningEffort | undefined,
): ResponsesRequestPayload {
  return {
    model: payload.model,
    input: translateMessagesToResponsesInput(payload.messages),
    stream: payload.stream,
    max_output_tokens: payload.max_tokens,
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: sanitizeUserIdentifier(payload.user),
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
    text:
      payload.response_format?.type === "json_object" ?
        { format: { type: "json_object" } }
      : undefined,
  }
}

export function translateResponsesToChatCompletion(
  response: ResponsesApiResponse,
): ChatCompletionResponse {
  const assistantMessages = response.output.filter(
    (item): item is ResponsesMessageOutputItem => item.type === "message",
  )
  const functionCalls = response.output.filter(
    (item): item is ResponsesFunctionCallOutputItem =>
      item.type === "function_call",
  )

  const content = assistantMessages
    .flatMap((item) => item.content)
    .map((part) => part.text)
    .join("")

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
          content: content || null,
          ...(functionCalls.length > 0 && {
            tool_calls: functionCalls.map((toolCall) => ({
              id: toolCall.call_id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments,
              },
            })),
          }),
        },
        logprobs: null,
        finish_reason: getFinishReason(response, functionCalls.length > 0),
      },
    ],
    usage: translateUsage(response.usage),
  }
}

export async function* translateResponsesStreamToChatCompletionStream(
  responseStream: AsyncIterable<ResponseStreamEventMessage>,
): AsyncGenerator<ResponseStreamEventMessage> {
  const state: ResponseTranslationState = {
    responseId: randomUUID(),
    createdAt: Math.floor(Date.now() / 1000),
    model: "",
    started: false,
  }

  for await (const rawEvent of responseStream) {
    if (!rawEvent.data || rawEvent.data === "[DONE]") {
      continue
    }

    const event = JSON.parse(rawEvent.data) as ResponsesStreamEnvelope

    if (event.response) {
      state.responseId = event.response.id
      state.createdAt = event.response.created_at
      state.model = event.response.model
    }

    if (event.type === "response.output_item.added") {
      const chunk = handleOutputItemAdded(state, event)
      if (chunk) {
        yield chunk
      }
      continue
    }

    if (event.type === "response.output_text.delta") {
      yield createRoleChunk(state)
      yield createChunk(state, { delta: { content: event.delta } })
      continue
    }

    if (event.type === "response.function_call_arguments.delta") {
      if (event.output_index === undefined) {
        continue
      }

      yield createRoleChunk(state)
      yield createChunk(state, {
        delta: {
          tool_calls: [
            {
              index: event.output_index,
              type: "function",
              function: {
                arguments: event.delta ?? "",
              },
            },
          ],
        },
      })
      continue
    }

    if (event.type === "response.completed") {
      if (!event.response) {
        continue
      }

      yield createChunk(
        {
          ...state,
          responseId: event.response.id,
          createdAt: event.response.created_at,
          model: event.response.model,
        },
        {
          delta: {},
          finishReason: getFinishReason(
            {
              output: event.response.output ?? [],
              incomplete_details: event.response.incomplete_details,
            },
            (event.response.output ?? []).some(
              (item) => item.type === "function_call",
            ),
          ),
          usage: translateUsage(event.response.usage),
        },
      )
      yield { data: "[DONE]" }
      return
    }
  }
}

function handleOutputItemAdded(
  state: ResponseTranslationState,
  event: ResponsesStreamEnvelope,
): ResponseStreamEventMessage | undefined {
  if (event.item?.type === "message") {
    return createRoleChunk(state)
  }

  if (
    event.item?.type === "function_call"
    && event.output_index !== undefined
  ) {
    state.started = true
    return createChunk(state, {
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: event.output_index,
            id: event.item.call_id,
            type: "function",
            function: {
              name: event.item.name,
              arguments: event.item.arguments ?? "",
            },
          },
        ],
      },
    })
  }

  return undefined
}

function createRoleChunk(
  state: ResponseTranslationState,
): ResponseStreamEventMessage {
  if (state.started) {
    return { data: "" }
  }

  state.started = true
  return createChunk(state, { delta: { role: "assistant" } })
}

function createChunk(
  state: ResponseTranslationState,
  { delta, finishReason = null, usage }: CreateChunkOptions,
): ResponseStreamEventMessage {
  return {
    data: JSON.stringify({
      id: state.responseId,
      object: "chat.completion.chunk",
      created: state.createdAt,
      model: state.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
          logprobs: null,
        },
      ],
      usage,
    } satisfies ChatCompletionChunk),
  }
}

function translateMessagesToResponsesInput(
  messages: Array<Message>,
): ResponsesInput {
  const items = messages.flatMap((message) => translateMessage(message))

  if (
    items.length === 1
    && "role" in items[0]
    && items[0].role === "user"
    && typeof items[0].content === "string"
  ) {
    return items[0].content
  }

  return items
}

function translateMessage(message: Message): Array<ResponsesInputItem> {
  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: stringifyToolOutput(message.content),
      },
    ]
  }

  const translated: Array<ResponsesInputItem> = []

  if (hasContent(message.content)) {
    translated.push({
      role: message.role,
      content: translateContent(message.content),
    })
  }

  if (message.role === "assistant" && message.tool_calls) {
    translated.push(
      ...message.tool_calls.map((toolCall) => ({
        type: "function_call" as const,
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })),
    )
  }

  return translated
}

function hasContent(content: Message["content"]): boolean {
  if (content === null) {
    return false
  }

  if (typeof content === "string") {
    return content.length > 0
  }

  return content.length > 0
}

function translateContent(
  content: Message["content"],
): ResponsesMessageInput["content"] {
  if (typeof content === "string") {
    return content
  }

  if (!content || content.length === 0) {
    return ""
  }

  return content.map((part) => translateContentPart(part))
}

function translateContentPart(part: ContentPart): ResponsesInputContentPart {
  if (part.type === "text") {
    return {
      type: "input_text",
      text: part.text,
    }
  }

  return {
    type: "input_image",
    image_url: part.image_url.url,
    detail: part.image_url.detail ?? "auto",
  }
}

function stringifyToolOutput(content: Message["content"]): string {
  if (typeof content === "string") {
    return content
  }

  if (!content) {
    return ""
  }

  const text = content
    .filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n")

  return text || JSON.stringify(content)
}

function translateTools(
  tools: Array<Tool> | null | undefined,
): Array<ResponsesTool> | undefined {
  if (!tools) {
    return undefined
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

function translateToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ResponsesToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === "string") {
    return toolChoice
  }

  return {
    type: "function",
    name: toolChoice.function.name,
  }
}

function translateUsage(
  usage: ResponsesApiResponse["usage"] | undefined,
): ChatCompletionResponse["usage"] | undefined {
  if (!usage) {
    return undefined
  }

  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    ...(usage.input_tokens_details?.cached_tokens !== undefined && {
      prompt_tokens_details: {
        cached_tokens: usage.input_tokens_details.cached_tokens,
      },
    }),
  }
}

function getFinishReason(
  response: Pick<ResponsesApiResponse, "output" | "incomplete_details">,
  hasFunctionCalls: boolean,
): "stop" | "length" | "tool_calls" | "content_filter" {
  if (hasFunctionCalls) {
    return "tool_calls"
  }

  if (response.incomplete_details?.reason?.includes("max_output_tokens")) {
    return "length"
  }

  return "stop"
}
