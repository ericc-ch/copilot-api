import { randomUUID } from "node:crypto"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"
import type {
  ResponseInputContent,
  ResponseInputMessage,
  ResponseTool,
  ResponsesOutputItem,
  ResponsesPayload,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesUsage,
} from "~/services/copilot/create-responses"

const toStringContent = (content: Message["content"]): string => {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .filter(Boolean)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
}

const toResponseContent = (
  content: Message["content"],
): Array<ResponseInputContent> => {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "input_text", text: content }] : []
  }

  if (!Array.isArray(content)) {
    return []
  }

  const parts: Array<ResponseInputContent> = []
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "input_text", text: part.text })
    }

    if (part.type === "image_url") {
      parts.push({
        type: "input_image",
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail,
        },
      })
    }
  }
  return parts
}

const toResponseToolCalls = (
  toolCalls: Array<ToolCall> | undefined,
): Array<ResponseInputContent> => {
  if (!toolCalls) {
    return []
  }

  return toolCalls.map((toolCall) => ({
    type: "tool_call",
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: toolCall.function.arguments,
  }))
}

const toResponseMessage = (message: Message): ResponseInputMessage | null => {
  if (message.role === "tool") {
    const toolCallId = message.tool_call_id
    if (toolCallId) {
      return {
        role: "tool",
        content: [
          {
            type: "tool_result",
            tool_call_id: toolCallId,
            output: toStringContent(message.content),
          },
        ],
      }
    }
  }

  const contentParts = [
    ...toResponseContent(message.content),
    ...toResponseToolCalls(message.tool_calls),
  ]

  if (contentParts.length === 0) {
    return null
  }

  if (message.role === "user" || message.role === "assistant") {
    return {
      role: message.role,
      content: contentParts,
    }
  }

  return null
}

const toResponseTools = (
  tools: Array<Tool> | null | undefined,
): Array<ResponseTool> | undefined => {
  if (!tools) {
    return undefined
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }))
}

export const translateChatToResponses = (
  payload: ChatCompletionsPayload,
): ResponsesPayload => {
  const systemMessages = payload.messages.filter(
    (message) => message.role === "system" || message.role === "developer",
  )
  const instructions = systemMessages
    .map((message) => toStringContent(message.content))
    .filter((content) => content.length > 0)
    .join("\n\n")

  const inputMessages = payload.messages
    .filter(
      (message) =>
        message.role === "user"
        || message.role === "assistant"
        || message.role === "tool",
    )
    .map((message) => toResponseMessage(message))
    .filter(Boolean)

  return {
    model: payload.model,
    instructions: instructions.length > 0 ? instructions : undefined,
    input: inputMessages,
    tools: toResponseTools(payload.tools),
    tool_choice: payload.tool_choice ?? undefined,
    reasoning:
      payload.reasoning_effort ?
        { effort: payload.reasoning_effort, summary: "auto" }
      : undefined,
    max_output_tokens: payload.max_tokens ?? undefined,
    temperature: payload.temperature ?? undefined,
    top_p: payload.top_p ?? undefined,
    frequency_penalty: payload.frequency_penalty ?? undefined,
    presence_penalty: payload.presence_penalty ?? undefined,
    logit_bias: payload.logit_bias ?? undefined,
    seed: payload.seed ?? undefined,
    stop: payload.stop ?? undefined,
    user: payload.user ?? undefined,
    stream: payload.stream ?? undefined,
    store: false,
    parallel_tool_calls: true,
  }
}

const extractTextFromOutputItem = (
  item: ResponsesOutputItem,
  acc: Array<string>,
  toolCalls: Array<ToolCall>,
): void => {
  switch (item.type) {
    case "output_text": {
      acc.push(item.text)
      break
    }
    case "function_call":
    case "tool_call": {
      toolCalls.push({
        id: item.id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      })
      break
    }
    case "message": {
      for (const content of item.content) {
        switch (content.type) {
          case "output_text": {
            acc.push(content.text)
            break
          }
          case "function_call":
          case "tool_call": {
            toolCalls.push({
              id: content.id,
              type: "function",
              function: {
                name: content.name,
                arguments: content.arguments,
              },
            })
            break
          }
          default: {
            break
          }
        }
      }
      break
    }
    default: {
      break
    }
  }
}

const mapUsageToChatUsage = (usage: ResponsesUsage | undefined) => {
  if (!usage) {
    return undefined
  }

  const prompt = usage.input_tokens ?? 0
  const completion = usage.output_tokens ?? 0
  const total = usage.total_tokens ?? prompt + completion

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  }
}

export const translateResponsesToChat = (
  response: ResponsesResponse,
): ChatCompletionResponse => {
  const textParts: Array<string> = []
  const toolCalls: Array<ToolCall> = []

  for (const item of response.output) {
    extractTextFromOutputItem(item, textParts, toolCalls)
  }

  const content = textParts.length > 0 ? textParts.join("") : null

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created ?? Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
    ...(response.usage && { usage: mapUsageToChatUsage(response.usage) }),
  }
}

export interface ResponsesStreamState {
  responseId: string
  created: number
  model: string
  started: boolean
  hadToolCalls: boolean
  completed: boolean
  nextToolCallIndex: number
  toolCallIndexById: Map<string, number>
  toolCalls: Map<number, { id: string; name: string }>
}

export const createResponsesStreamState = (
  model: string,
): ResponsesStreamState => ({
  responseId: `resp_${randomUUID()}`,
  created: Math.floor(Date.now() / 1000),
  model,
  started: false,
  hadToolCalls: false,
  completed: false,
  nextToolCallIndex: 0,
  toolCallIndexById: new Map(),
  toolCalls: new Map(),
})

const ensureStartedChunks = (
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  if (state.started) {
    return []
  }

  state.started = true
  return [
    {
      id: state.responseId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null,
          logprobs: null,
        },
      ],
    },
  ]
}

const buildChunk = (
  state: ResponsesStreamState,
  options: {
    delta: ChatCompletionChunk["choices"][number]["delta"]
    finishReason?: ChatCompletionChunk["choices"][number]["finish_reason"]
    usage?: ChatCompletionChunk["usage"]
  },
): ChatCompletionChunk => ({
  id: state.responseId,
  object: "chat.completion.chunk",
  created: state.created,
  model: state.model,
  choices: [
    {
      index: 0,
      delta: options.delta,
      finish_reason: options.finishReason ?? null,
      logprobs: null,
    },
  ],
  ...(options.usage ? { usage: options.usage } : {}),
})

const getToolCallIndex = (
  state: ResponsesStreamState,
  id: string | undefined,
  outputIndex: number | undefined,
): number | null => {
  if (typeof outputIndex === "number") {
    return outputIndex
  }

  if (!id) {
    return null
  }

  const existing = state.toolCallIndexById.get(id)
  if (existing !== undefined) {
    return existing
  }

  const nextIndex = state.nextToolCallIndex
  state.nextToolCallIndex += 1
  state.toolCallIndexById.set(id, nextIndex)
  return nextIndex
}

const registerToolCall = (options: {
  state: ResponsesStreamState
  index: number
  id: string
  name: string
}) => {
  options.state.toolCalls.set(options.index, {
    id: options.id,
    name: options.name,
  })
  options.state.toolCallIndexById.set(options.id, options.index)
  options.state.hadToolCalls = true
}

const mapUsageToChunkUsage = (usage: ResponsesUsage | undefined) => {
  if (!usage) {
    return undefined
  }

  const prompt = usage.input_tokens ?? 0
  const completion = usage.output_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.total_tokens ?? prompt + completion,
  }
}

const handleOutputItemAdded = (
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  if (!event.item) {
    return []
  }

  if (event.item.type !== "function_call" && event.item.type !== "tool_call") {
    return []
  }

  const index = getToolCallIndex(state, event.item.id, event.output_index)
  if (index === null) {
    return []
  }

  registerToolCall({
    state,
    index,
    id: event.item.id,
    name: event.item.name,
  })

  return [
    ...ensureStartedChunks(state),
    buildChunk(state, {
      delta: {
        tool_calls: [
          {
            index,
            id: event.item.id,
            type: "function",
            function: {
              name: event.item.name,
              arguments: "",
            },
          },
        ],
      },
    }),
  ]
}

const handleOutputTextDelta = (
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  const delta = event.delta ?? event.text ?? ""
  if (!delta) {
    return []
  }

  return [
    ...ensureStartedChunks(state),
    buildChunk(state, { delta: { content: delta } }),
  ]
}

const handleFunctionCallArgumentsDelta = (
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  const index = getToolCallIndex(state, event.item_id, event.output_index)
  if (index === null) {
    return []
  }

  const toolCall = state.toolCalls.get(index)
  const toolCallId = toolCall?.id ?? event.item_id ?? `call_${index}`
  const toolCallName = toolCall?.name ?? "tool"
  const toolCallArguments = event.delta ?? ""

  state.hadToolCalls = true

  return [
    ...ensureStartedChunks(state),
    buildChunk(state, {
      delta: {
        tool_calls: [
          {
            index,
            id: toolCallId,
            type: "function",
            function: {
              name: toolCallName,
              arguments: toolCallArguments,
            },
          },
        ],
      },
    }),
  ]
}

const handleResponseCompleted = (
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  const usage = mapUsageToChunkUsage(event.response?.usage)
  state.completed = true
  return [
    buildChunk(state, {
      delta: {},
      finishReason: state.hadToolCalls ? "tool_calls" : "stop",
      usage,
    }),
  ]
}

export const translateResponsesEventToChatChunks = (
  event: ResponsesStreamEvent,
  eventType: string | undefined,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> => {
  const type = event.type ?? eventType ?? ""
  switch (type) {
    case "response.output_item.added": {
      return handleOutputItemAdded(event, state)
    }
    case "response.output_text.delta": {
      return handleOutputTextDelta(event, state)
    }
    case "response.function_call_arguments.delta": {
      return handleFunctionCallArgumentsDelta(event, state)
    }
    case "response.completed": {
      return handleResponseCompleted(event, state)
    }
    default: {
      return []
    }
  }
}
