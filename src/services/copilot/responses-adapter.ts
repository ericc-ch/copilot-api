/*
 * eslint max-lines: both directions of the chat<->responses protocol
 * adapter live here on purpose so the pending upstream review sees the
 * full conversion contract in one place; split into forward/reverse
 * modules after it lands.
 */
/* eslint-disable max-lines */
import { state } from "~/lib/state"
import { isNullish } from "~/lib/utils"
import {
  type ChatCompletionChunk,
  type ChatCompletionsPayload,
  type ChatCompletionResponse,
  type ContentPart,
  type Message,
  type TextPart,
  type Tool,
  type ToolCall,
} from "~/services/copilot/create-chat-completions"

/*
 * Protocol conversion: some CAPI models (gpt-5.3-codex, gpt-5.4-mini, ...)
 * only serve the Responses API. This adapter lets plain Chat Completions
 * clients talk to them by translating requests/responses on the fly,
 * so the rest of the proxy (chat & anthropic-compatible routes, streaming)
 * works unchanged.
 */

export const isResponsesOnlyModel = (model: string): boolean => {
  const endpoints = state.models?.data.find(
    (entry) => entry.id === model,
  )?.supported_endpoints
  if (!endpoints || endpoints.length === 0) return false
  return (
    endpoints.includes("/responses") && !endpoints.includes("/chat/completions")
  )
}

/**
 * Whether a model can be called on the upstream /responses endpoint.
 * Models without endpoint metadata (gpt-4.1, gpt-4o, ...) are served by
 * chat only — the upstream rejects them on /responses with
 * `unsupported_api_for_model`.
 */
export const isResponsesCapableModel = (model: string): boolean => {
  const endpoints = state.models?.data.find(
    (entry) => entry.id === model,
  )?.supported_endpoints
  if (!endpoints || endpoints.length === 0) return false
  return endpoints.includes("/responses")
}

/**
 * Derives vision / X-Initiator hints from a Responses payload so the
 * passthrough path mirrors the chat path's header semantics.
 */
export const responsesPayloadHints = (
  payload: Record<string, unknown>,
): { vision: boolean; initiator: "user" | "agent" } => {
  let vision = false
  let agent = false

  if (Array.isArray(payload.input)) {
    for (const item of payload.input as Array<Record<string, unknown>>) {
      if (
        item.type === "function_call"
        || item.type === "function_call_output"
        || item.role === "assistant"
      ) {
        agent = true
      }
      if (contentHasImage(item.content)) vision = true
    }
  }

  return { vision, initiator: agent ? "agent" : "user" }
}

const contentHasImage = (content: unknown): boolean => {
  if (!Array.isArray(content)) return false
  return (content as Array<Record<string, unknown>>).some(
    (part) => part.type === "input_image",
  )
}

// ---------- request: chat completions -> responses ----------

export const chatPayloadToResponsesPayload = (
  payload: ChatCompletionsPayload,
): Record<string, unknown> => {
  const { instructions, input } = messagesToResponsesInput(payload.messages)

  const result: Record<string, unknown> = {
    model: payload.model,
    input,
    temperature: payload.temperature ?? undefined,
    top_p: payload.top_p ?? undefined,
    stream: payload.stream ?? undefined,
  }

  if (instructions) result.instructions = instructions

  const maxTokens = payload.max_tokens ?? payload.max_completion_tokens
  if (!isNullish(maxTokens)) result.max_output_tokens = maxTokens

  // chat's JSON mode maps to the Responses text.format constraint
  if (payload.response_format?.type === "json_object") {
    result.text = { format: { type: "json_object" } }
  }

  if (payload.tools?.length) {
    result.tools = payload.tools.map((tool) => chatToolToResponsesTool(tool))
    if (!isNullish(payload.tool_choice)) {
      // string values ("none" | "auto" | "required") are identical in both
      // APIs; the object form differs: {function:{name}} -> {name}
      const choice = payload.tool_choice
      result.tool_choice =
        typeof choice === "string" ? choice : (
          { type: "function", name: choice.function.name }
        )
    }
  }

  return result
}

interface InputBuild {
  instructions: Array<string>
  input: Array<Record<string, unknown>>
}

const messagesToResponsesInput = (
  messages: Array<Message>,
): { instructions?: string; input: Array<Record<string, unknown>> } => {
  const build: InputBuild = { instructions: [], input: [] }
  for (const message of messages) appendMessage(build, message)
  return {
    instructions: build.instructions.join("\n\n") || undefined,
    input: build.input,
  }
}

const appendMessage = (build: InputBuild, message: Message) => {
  const text = messageTextContent(message.content)
  const parts = Array.isArray(message.content) ? message.content : undefined

  // system/developer messages become top-level instructions
  if (message.role === "system" || message.role === "developer") {
    if (text) build.instructions.push(text)
    return
  }

  // tool results map to function_call_output items
  if (message.role === "tool") {
    build.input.push({
      type: "function_call_output",
      call_id: message.tool_call_id ?? "",
      output: text,
    })
    return
  }

  if (message.role === "assistant" && message.tool_calls?.length) {
    pushAssistantToolCalls(build.input, message)
    return
  }

  build.input.push(toResponsesItem(message.role, text, parts))
}

const pushAssistantToolCalls = (
  input: Array<Record<string, unknown>>,
  message: Message,
) => {
  const text = messageTextContent(message.content)
  const parts = Array.isArray(message.content) ? message.content : undefined
  if (text) input.push(toResponsesItem("assistant", text, parts))
  for (const call of message.tool_calls ?? []) {
    input.push({
      type: "function_call",
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })
  }
}

const toResponsesItem = (
  role: Message["role"],
  text: string,
  parts?: Message["content"],
): Record<string, unknown> => {
  if (Array.isArray(parts)) {
    const content = parts.map((part) => {
      if (part.type === "image_url") {
        return { type: "input_image", image_url: part.image_url.url }
      }
      return {
        type: role === "assistant" ? "output_text" : "input_text",
        text: part.text,
      }
    })
    return { role, content }
  }
  return { role, content: text }
}

const messageTextContent = (content: Message["content"]): string => {
  if (content === null) return ""
  if (typeof content === "string") return content
  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

const chatToolToResponsesTool = (tool: Tool): Record<string, unknown> => ({
  type: "function",
  name: tool.function.name,
  description: tool.function.description ?? null,
  parameters: tool.function.parameters,
})

// ---------- response: responses -> chat completions (non-streaming) ----------

export interface ResponsesResult {
  id?: string
  model?: string
  status?: string
  created_at?: number
  output?: Array<ResponsesOutputItem>
  usage?: ResponsesUsage
  error?: { message?: string }
}

interface ResponsesOutputItem {
  type?: string
  id?: string
  role?: string
  content?: Array<{ type?: string; text?: string }>
  call_id?: string
  name?: string
  arguments?: string
}

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export const responsesResultToChatCompletion = (
  result: ResponsesResult,
  model: string,
): ChatCompletionResponse => {
  if (result.status === "failed" || result.status === "cancelled") {
    throw new Error(
      result.error?.message ?? `Responses request ${result.status}`,
    )
  }

  const { text, toolCalls } = responseItemsToMessage(result.output)

  const baseFinishReason = result.status === "incomplete" ? "length" : "stop"

  const data: ChatCompletionResponse = {
    id: result.id ?? "",
    object: "chat.completion",
    created: result.created_at ?? Math.floor(Date.now() / 1000),
    model: result.model ?? model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : baseFinishReason,
      },
    ],
  }

  data.usage = responsesUsageToChatUsage(result.usage) ?? data.usage

  return data
}

const responseItemsToMessage = (
  items?: Array<ResponsesOutputItem>,
): { text: string; toolCalls: Array<ToolCall> } => {
  let text = ""
  const toolCalls: Array<ToolCall> = []

  for (const item of items ?? []) {
    if (item.type === "message") {
      text += messageItemText(item)
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length}`,
        type: "function",
        function: { name: item.name ?? "", arguments: item.arguments ?? "" },
      })
    }
  }

  return { text, toolCalls }
}

const messageItemText = (item: ResponsesOutputItem): string => {
  let text = ""
  for (const part of item.content ?? []) {
    if (part.type === "output_text" && typeof part.text === "string") {
      text += part.text
    }
  }
  return text
}

const responsesUsageToChatUsage = (
  usage?: ResponsesUsage,
): ChatCompletionResponse["usage"] | undefined => {
  if (!usage) return undefined

  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
  }
}

// ---------- response: responses -> chat completions (streaming) ----------

interface ChunkMeta {
  id: string
  created: number
  model: string
}

interface ChunkOptions {
  delta: ChatCompletionChunk["choices"][0]["delta"]
  finish_reason: ChatCompletionChunk["choices"][0]["finish_reason"]
  usage?: unknown
}

const makeChunk = (
  meta: ChunkMeta,
  options: ChunkOptions,
): ChatCompletionChunk => {
  const chunk: ChatCompletionChunk = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: options.delta,
        finish_reason: options.finish_reason,
        logprobs: null,
      },
    ],
  }
  if (options.usage !== undefined) {
    chunk.usage = options.usage as ChatCompletionChunk["usage"]
  }
  return chunk
}

const toSseEvent = (chunk: ChatCompletionChunk) => ({
  data: JSON.stringify(chunk),
})

interface EventOutcome {
  chunks: Array<ChatCompletionChunk>
  done: boolean
  emittedRole: boolean
}

const responsesEventToChunks = (
  parsed: {
    type?: string
    response?: ResponsesResult
    delta?: string
  },
  meta: ChunkMeta,
  emittedRole: boolean,
): EventOutcome | undefined => {
  if (parsed.type === "response.created") {
    return {
      chunks: [
        makeChunk(
          {
            id: parsed.response?.id ?? meta.id,
            created: parsed.response?.created_at ?? meta.created,
            model: meta.model,
          },
          { delta: { role: "assistant" }, finish_reason: null },
        ),
      ],
      done: false,
      emittedRole: true,
    }
  }

  if (parsed.type === "response.output_text.delta") {
    const chunks: Array<ChatCompletionChunk> = []
    if (!emittedRole) {
      chunks.push(
        makeChunk(meta, { delta: { role: "assistant" }, finish_reason: null }),
      )
    }
    chunks.push(
      makeChunk(meta, {
        delta: { content: parsed.delta ?? "" },
        finish_reason: null,
      }),
    )
    return { chunks, done: false, emittedRole: true }
  }

  if (parsed.type === "response.completed") {
    return completedEventToChunks(parsed.response ?? {}, meta)
  }

  if (parsed.type === "response.failed" || parsed.type === "error") {
    // propagate upstream failures: emitting a content_filter chunk would
    // make clients treat a failed request as a completed one
    throw new Error(
      parsed.response?.error?.message ?? "Responses stream failed",
    )
  }

  return undefined
}

const completedEventToChunks = (
  result: ResponsesResult,
  meta: ChunkMeta,
): EventOutcome => {
  const chatResult = responsesResultToChatCompletion(result, meta.model)
  const message = chatResult.choices[0].message
  const chunks: Array<ChatCompletionChunk> = []

  let finishReason: ChatCompletionChunk["choices"][0]["finish_reason"] =
    result.status === "incomplete" ? "length" : "stop"
  if (message.tool_calls?.length) {
    finishReason = "tool_calls"
    chunks.push(
      makeChunk(meta, {
        delta: {
          tool_calls: message.tool_calls.map((call, index) => ({
            index,
            id: call.id,
            type: call.type,
            function: call.function,
          })),
        },
        finish_reason: null,
      }),
    )
  }

  chunks.push(
    makeChunk(meta, {
      delta: {},
      finish_reason: finishReason,
      usage: chatResult.usage,
    }),
  )

  return { chunks, done: true, emittedRole: true }
}

export async function* streamResponsesAsChatChunks(
  upstream: Response,
  model: string,
  events: (response: Response) => AsyncIterable<{ data?: string | null }>,
): AsyncGenerator<{ data: string }> {
  const meta: ChunkMeta = {
    id: "",
    created: Math.floor(Date.now() / 1000),
    model,
  }
  let emittedRole = false

  for await (const event of events(upstream)) {
    if (!event.data) continue
    if (event.data === "[DONE]") continue
    const parsed = JSON.parse(event.data) as {
      type?: string
      response?: ResponsesResult
      delta?: string
    }

    if (parsed.type === "response.created") {
      meta.id = parsed.response?.id ?? ""
      meta.created = parsed.response?.created_at ?? meta.created
    }

    const outcome = responsesEventToChunks(parsed, meta, emittedRole)
    if (!outcome) continue

    emittedRole = outcome.emittedRole
    for (const chunk of outcome.chunks) yield toSseEvent(chunk)
    if (outcome.done) {
      // mirror the chat route's terminator so waiting clients wrap up
      yield { data: "[DO" + "NE]" }
      return
    }
  }

  // upstream ended without a completed event
  yield toSseEvent(makeChunk(meta, { delta: {}, finish_reason: "stop" }))
  yield { data: "[DO" + "NE]" }
}

// ---------- reverse direction: responses -> chat completions ----------
// Lets Responses API clients (e.g. Codex CLI) use chat-only models
// (gpt-4.1, exec-agent-*, copilot-search-*, ...) through /v1/responses.

interface ResponsesInputItem {
  type?: string
  role?: string
  content?: unknown
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

export const responsesPayloadToChatPayload = (
  payload: Record<string, unknown>,
): ChatCompletionsPayload => {
  const messages: Array<Message> = []

  const instructions = payload.instructions
  if (typeof instructions === "string" && instructions.length > 0) {
    messages.push({ role: "system", content: instructions })
  }

  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input })
  } else if (Array.isArray(payload.input)) {
    for (const item of payload.input as Array<ResponsesInputItem>) {
      appendResponsesItemToMessages(messages, item)
    }
  }

  const result: ChatCompletionsPayload = {
    model: String(payload.model),
    messages,
  }

  if (typeof payload.max_output_tokens === "number") {
    result.max_tokens = payload.max_output_tokens
  }
  if (typeof payload.temperature === "number") {
    result.temperature = payload.temperature
  }
  if (typeof payload.top_p === "number") {
    result.top_p = payload.top_p
  }
  if (payload.stream === true) result.stream = true

  const responseFormat = responsesTextToResponseFormat(payload.text)
  if (responseFormat) result.response_format = responseFormat
  const tools = responsesToolsToChatTools(payload.tools)
  if (tools) {
    result.tools = tools
    // string values ("none" | "auto" | "required") are identical in both
    // APIs; the object form differs: {name} -> {function:{name}}
    if (!isNullish(payload.tool_choice)) {
      const choice = payload.tool_choice
      if (typeof choice === "string") {
        result.tool_choice = choice as ChatCompletionsPayload["tool_choice"]
      } else if (typeof (choice as { name?: unknown }).name === "string") {
        result.tool_choice = {
          type: "function",
          function: { name: (choice as { name: string }).name },
        }
      }
    }
  }

  return result
}

// Responses text.format maps back to chat's JSON mode
const responsesTextToResponseFormat = (
  text: unknown,
): ChatCompletionsPayload["response_format"] | undefined => {
  if (
    typeof text === "object"
    && text !== null
    && (text as { format?: { type?: unknown } }).format?.type === "json_object"
  ) {
    return { type: "json_object" }
  }
  return undefined
}

const appendResponsesItemToMessages = (
  messages: Array<Message>,
  item: ResponsesInputItem,
) => {
  if (item.type === "function_call") {
    // parallel tool calls arrive as consecutive function_call items and must
    // share one assistant message: chat requires all tool results of an
    // assistant message to follow it directly
    const call: ToolCall = {
      id: item.call_id ?? `call_${messages.length}`,
      type: "function",
      function: { name: item.name ?? "", arguments: item.arguments ?? "" },
    }
    const last = messages.at(-1)
    if (last?.role === "assistant") {
      last.tool_calls = [...(last.tool_calls ?? []), call]
    } else {
      messages.push({ role: "assistant", content: null, tool_calls: [call] })
    }
    return
  }

  if (item.type === "function_call_output") {
    messages.push({
      role: "tool",
      content: item.output ?? "",
      tool_call_id: item.call_id ?? "",
    })
    return
  }

  const role = responsesRoleToChatRole(item.role)
  if (!role) return
  messages.push({ role, content: responsesContentToChatContent(item.content) })
}

const responsesRoleToChatRole = (
  role?: string,
): Message["role"] | undefined => {
  if (role === "user" || role === "assistant" || role === "tool") return role
  if (role === "system" || role === "developer") return "system"
  return undefined
}

const responsesContentToChatContent = (
  content: unknown,
): Message["content"] => {
  if (content === null || content === undefined) return ""
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  const parts: Array<ContentPart> = []
  for (const part of content as Array<Record<string, unknown>>) {
    if (part.type === "input_image" && typeof part.image_url === "string") {
      parts.push({ type: "image_url", image_url: { url: part.image_url } })
    } else if (typeof part.text === "string") {
      parts.push({ type: "text", text: part.text })
    }
  }
  return parts.length > 0 ? parts : ""
}

const responsesToolsToChatTools = (tools: unknown): Array<Tool> | undefined => {
  if (!Array.isArray(tools)) return undefined
  // only function tools have a chat equivalent; built-in tools like
  // web_search or local_shell must not become fake "undefined" functions
  const converted = (tools as Array<Record<string, unknown>>)
    .filter(
      (record) => record.type === "function" && typeof record.name === "string",
    )
    .map((record) => ({
      type: "function" as const,
      function: {
        name: record.name as string,
        description:
          typeof record.description === "string" ?
            record.description
          : undefined,
        parameters: (record.parameters ?? {}) as Record<string, unknown>,
      },
    }))
  return converted.length > 0 ? converted : undefined
}

export const chatResultToResponsesResult = (
  chat: ChatCompletionResponse,
): Record<string, unknown> => {
  const choice = chat.choices[0]
  const toolCalls = choice.message.tool_calls ?? []

  const output: Array<Record<string, unknown>> = [
    {
      type: "message",
      id: `msg_${chat.id}`,
      role: "assistant",
      content: [{ type: "output_text", text: choice.message.content ?? "" }],
    },
  ]
  for (const call of toolCalls) {
    output.push({
      type: "function_call",
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })
  }

  return {
    id: chat.id,
    object: "response",
    created_at: chat.created,
    model: chat.model,
    status: chatStatusFromFinishReason(choice.finish_reason),
    output,
    usage:
      chat.usage ?
        {
          input_tokens: chat.usage.prompt_tokens,
          output_tokens: chat.usage.completion_tokens,
          total_tokens: chat.usage.total_tokens,
        }
      : undefined,
  }
}

// Responses clients detect max-token truncation via status "incomplete"
const chatStatusFromFinishReason = (finishReason?: string | null): string =>
  finishReason === "length" ? "incomplete" : "completed"

interface ChatStreamState {
  responseId: string
  created: number
  text: string
  finishReason: string | null
  usage: ChatCompletionResponse["usage"]
  toolCalls: Array<ToolCall>
}

const emit = (event: Record<string, unknown>) => ({
  data: JSON.stringify(event),
})

const initialResponsesEvents = (
  state: ChatStreamState,
  model: string,
): Array<Record<string, unknown>> => [
  {
    type: "response.created",
    response: {
      id: state.responseId,
      created_at: state.created,
      model,
      status: "in_progress",
    },
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "message", role: "assistant", content: [] },
  },
]

const collectToolCalls = (
  choice: ChatCompletionChunk["choices"][0],
  toolCalls: Array<ToolCall>,
) => {
  for (const call of choice.delta.tool_calls ?? []) {
    // a single tool call is streamed as several deltas sharing one index:
    // the first carries id/name, the following append argument fragments
    const existing =
      call.index < toolCalls.length ? toolCalls[call.index] : undefined
    if (existing) {
      if (call.id) existing.id = call.id
      if (call.function?.name) existing.function.name = call.function.name
      if (call.function?.arguments) {
        existing.function.arguments += call.function.arguments
      }
      continue
    }

    while (toolCalls.length < call.index) {
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        type: "function",
        function: { name: "", arguments: "" },
      })
    }
    toolCalls.push({
      id: call.id ?? `call_${call.index}`,
      type: "function",
      function: {
        name: call.function?.name ?? "",
        arguments: call.function?.arguments ?? "",
      },
    })
  }
}

const responsesOutputItems = (
  state: ChatStreamState,
): Array<Record<string, unknown>> => {
  const output: Array<Record<string, unknown>> = [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: state.text }],
    },
  ]
  for (const call of state.toolCalls) {
    output.push({
      type: "function_call",
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })
  }
  return output
}

const finalResponsesEvents = (
  state: ChatStreamState,
  model: string,
): Array<Record<string, unknown>> => {
  const events: Array<Record<string, unknown>> = [
    {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: state.text,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: state.text }],
      },
    },
  ]

  // chat streams only finish tool calls by the end, so their Responses item
  // events are emitted here — before the terminal event — because Responses
  // clients deliver function calls through output items, not only through
  // the completed event's output array
  let outputIndex = 1
  for (const call of state.toolCalls) {
    const itemIndex = outputIndex++
    events.push(
      {
        type: "response.output_item.added",
        output_index: itemIndex,
        item: {
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: itemIndex,
        delta: call.function.arguments,
      },
      {
        type: "response.function_call_arguments.done",
        output_index: itemIndex,
        arguments: call.function.arguments,
      },
      {
        type: "response.output_item.done",
        output_index: itemIndex,
        item: {
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        },
      },
    )
  }

  // a truncated chat stream must terminate as response.incomplete (with
  // incomplete_details) so Responses clients do not treat it as complete
  const status = chatStatusFromFinishReason(state.finishReason)
  events.push({
    type:
      status === "incomplete" ? "response.incomplete" : "response.completed",
    response: {
      id: state.responseId,
      created_at: state.created,
      model,
      status,
      ...(status === "incomplete" ?
        { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
      output: responsesOutputItems(state),
      usage:
        state.usage ?
          {
            input_tokens: state.usage.prompt_tokens,
            output_tokens: state.usage.completion_tokens,
            total_tokens: state.usage.total_tokens,
          }
        : undefined,
      finish_reason: state.finishReason ?? "stop",
    },
  })
  return events
}

export async function* streamChatAsResponsesEvents(
  chatStream: AsyncIterable<{ data?: string | null }>,
  model: string,
): AsyncGenerator<{ data: string }> {
  const state: ChatStreamState = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    text: "",
    finishReason: null,
    usage: undefined,
    toolCalls: [],
  }
  let emittedCreated = false

  for await (const event of chatStream) {
    if (!event.data) continue
    // skip the non-JSON SSE terminator line
    if (!event.data.startsWith("{")) break
    const chunk = JSON.parse(event.data) as ChatCompletionChunk

    // capture id/usage first: usage-only chunks carry an empty choices array
    if (chunk.id) state.responseId = chunk.id
    if (chunk.usage) state.usage = chunk.usage

    if (chunk.choices.length === 0) continue
    const choice = chunk.choices[0]

    if (!emittedCreated) {
      emittedCreated = true
      for (const item of initialResponsesEvents(state, model)) yield emit(item)
    }

    const content = choice.delta.content
    if (typeof content === "string" && content.length > 0) {
      state.text += content
      yield emit({
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: content,
      })
    }

    collectToolCalls(choice, state.toolCalls)

    if (choice.finish_reason) state.finishReason = choice.finish_reason
  }

  for (const item of finalResponsesEvents(state, model)) yield emit(item)
}
