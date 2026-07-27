import type {
  ResponseOutputFunctionCall,
  ResponseOutputReasoning,
  ResponsesResult,
} from "~/services/copilot/create-responses"

import type { AnthropicStreamEventData } from "./anthropic-types"

import { translateResponsesToAnthropic } from "./responses-translation"

interface StreamBlock {
  index: number
  kind: "text" | "thinking" | "tool_use"
  outputIndex: number
  hasDelta: boolean
  itemId?: string
  toolCallId?: string
  toolName?: string
}

export interface ResponsesStreamState {
  messageStartSent: boolean
  messageCompleted: boolean
  nextBlockIndex: number
  currentBlock?: StreamBlock
  blocksByOutputIndex: Map<number, StreamBlock>
  currentResponseId?: string
  currentModel?: string
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    messageStartSent: false,
    messageCompleted: false,
    nextBlockIndex: 0,
    blocksByOutputIndex: new Map(),
  }
}

export function translateResponsesStreamEvent(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  switch (event.type) {
    case "response.created": {
      return ensureMessageStart(state, getResponse(event))
    }
    case "response.output_item.added": {
      return handleOutputItemAdded(event, state)
    }
    case "response.reasoning_summary_text.delta": {
      return handleTextDelta(event, state, "thinking")
    }
    case "response.output_text.delta": {
      return handleTextDelta(event, state, "text")
    }
    case "response.output_text.done": {
      return handleTextDone(event, state)
    }
    case "response.function_call_arguments.delta": {
      return handleToolArgumentsDelta(event, state)
    }
    case "response.function_call_arguments.done": {
      return handleToolArgumentsDone(event, state)
    }
    case "response.output_item.done": {
      return handleOutputItemDone(event, state)
    }
    case "response.completed":
    case "response.incomplete": {
      return handleResponseCompleted(event, state)
    }
    case "response.failed": {
      return handleResponseFailure(event, state)
    }
    case "error": {
      state.messageCompleted = true
      return [
        errorEvent(
          getErrorMessage(event) ?? "Copilot Responses stream failed.",
        ),
      ]
    }
    default: {
      return []
    }
  }
}

function handleOutputItemAdded(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state, getResponse(event))
  const item = getRecord(event.item)
  const outputIndex = getNumber(event.output_index)
  if (!item || outputIndex === undefined) return events

  if (item.type === "reasoning") {
    openBlock(state, events, {
      kind: "thinking",
      outputIndex,
      itemId: getString(item.id),
    })
    return events
  }

  if (item.type === "function_call") {
    const block = openBlock(state, events, {
      kind: "tool_use",
      outputIndex,
      itemId: getString(item.id),
      toolCallId:
        getString(item.call_id) ?? getString(item.id) ?? `tool_${outputIndex}`,
      toolName: getString(item.name) ?? "function",
    })
    const argumentsText = getString(item.arguments)
    if (argumentsText) {
      events.push(toolArgumentsDelta(block.index, argumentsText))
      block.hasDelta = true
    }
  }

  return events
}

function handleTextDelta(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
  kind: "text" | "thinking",
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const delta = getString(event.delta)
  const outputIndex = getNumber(event.output_index) ?? 0
  if (!delta) return events

  const block = openBlock(state, events, { kind, outputIndex })
  events.push({
    type: "content_block_delta",
    index: block.index,
    delta:
      kind === "thinking" ?
        { type: "thinking_delta", thinking: delta }
      : { type: "text_delta", text: delta },
  })
  block.hasDelta = true
  return events
}

function handleTextDone(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const outputIndex = getNumber(event.output_index) ?? 0
  const block = state.blocksByOutputIndex.get(outputIndex)
  if (!block || block.kind !== "text") return events

  const text = getString(event.text)
  if (!block.hasDelta && text) {
    events.push({
      type: "content_block_delta",
      index: block.index,
      delta: { type: "text_delta", text },
    })
    block.hasDelta = true
  }
  closeBlock(state, events, block)
  return events
}

function handleToolArgumentsDelta(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const outputIndex = resolveOutputIndex(event, state)
  const delta = getString(event.delta)
  if (outputIndex === undefined || !delta) return events

  const block = openBlock(state, events, {
    kind: "tool_use",
    outputIndex,
  })
  events.push(toolArgumentsDelta(block.index, delta))
  block.hasDelta = true
  return events
}

function handleToolArgumentsDone(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const outputIndex = resolveOutputIndex(event, state)
  if (outputIndex === undefined) return events

  const block = openBlock(state, events, {
    kind: "tool_use",
    outputIndex,
  })
  const argumentsText = getString(event.arguments)
  if (!block.hasDelta && argumentsText) {
    events.push(toolArgumentsDelta(block.index, argumentsText))
    block.hasDelta = true
  }
  closeBlock(state, events, block)
  return events
}

function handleOutputItemDone(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const outputIndex = getNumber(event.output_index)
  const item = getRecord(event.item)
  if (outputIndex === undefined || !item) return events

  const block = state.blocksByOutputIndex.get(outputIndex)
  if (!block) return events

  if (item.type === "reasoning") {
    const reasoning = item as unknown as ResponseOutputReasoning
    if (!block.hasDelta) {
      const thinking = reasoning.summary
        ?.map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n\n")
      events.push({
        type: "content_block_delta",
        index: block.index,
        delta: {
          type: "thinking_delta",
          thinking: thinking || "Thinking...",
        },
      })
      block.hasDelta = true
    }
    if (reasoning.encrypted_content) {
      events.push({
        type: "content_block_delta",
        index: block.index,
        delta: {
          type: "signature_delta",
          signature: `${reasoning.encrypted_content}@${reasoning.id}`,
        },
      })
    }
  }

  if (item.type === "function_call" && !block.hasDelta) {
    const call = item as unknown as ResponseOutputFunctionCall
    if (call.arguments) {
      events.push(toolArgumentsDelta(block.index, call.arguments))
      block.hasDelta = true
    }
  }

  closeBlock(state, events, block)
  return events
}

function handleResponseCompleted(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const response = getResponse(event)
  const events = ensureMessageStart(state, response)
  closeCurrentBlock(state, events)

  const anthropic = response ? translateResponsesToAnthropic(response) : null
  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: anthropic?.stop_reason ?? null,
        stop_sequence: null,
      },
      ...(anthropic ? { usage: anthropic.usage } : {}),
    },
    { type: "message_stop" },
  )
  state.messageCompleted = true
  return events
}

function handleResponseFailure(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const response = getResponse(event)
  const events = ensureMessageStart(state, response)
  closeCurrentBlock(state, events)
  events.push(
    errorEvent(
      response?.error?.message
        ?? getErrorMessage(event)
        ?? "Copilot Responses request failed.",
    ),
  )
  state.messageCompleted = true
  return events
}

function ensureMessageStart(
  state: ResponsesStreamState,
  response?: ResponsesResult,
): Array<AnthropicStreamEventData> {
  if (response) {
    state.currentResponseId = response.id
    state.currentModel = response.model
  }
  if (state.messageStartSent) return []

  state.messageStartSent = true
  return [
    {
      type: "message_start",
      message: {
        id: response?.id ?? state.currentResponseId ?? "response",
        type: "message",
        role: "assistant",
        content: [],
        model: response?.model ?? state.currentModel ?? "",
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: response?.usage?.input_tokens ?? 0,
          output_tokens: 0,
        },
      },
    },
  ]
}

function openBlock(
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
  details: Omit<StreamBlock, "index" | "hasDelta">,
): StreamBlock {
  const existing = state.blocksByOutputIndex.get(details.outputIndex)
  if (existing) return existing

  closeCurrentBlock(state, events)
  const block: StreamBlock = {
    ...details,
    index: state.nextBlockIndex,
    hasDelta: false,
  }
  state.nextBlockIndex += 1
  state.currentBlock = block
  state.blocksByOutputIndex.set(block.outputIndex, block)

  events.push({
    type: "content_block_start",
    index: block.index,
    content_block: createContentBlockStart(block),
  })
  return block
}

function createContentBlockStart(
  block: StreamBlock,
):
  | { type: "tool_use"; id: string; name: string; input: Record<string, never> }
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string } {
  if (block.kind === "tool_use") {
    return {
      type: "tool_use",
      id: block.toolCallId ?? `tool_${block.outputIndex}`,
      name: block.toolName ?? "function",
      input: {},
    }
  }
  if (block.kind === "thinking") {
    return { type: "thinking", thinking: "" }
  }
  return { type: "text", text: "" }
}

function closeCurrentBlock(
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (state.currentBlock) closeBlock(state, events, state.currentBlock)
}

function closeBlock(
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
  block: StreamBlock,
): void {
  if (state.currentBlock?.index !== block.index) return
  events.push({ type: "content_block_stop", index: block.index })
  state.currentBlock = undefined
}

function toolArgumentsDelta(
  index: number,
  partialJson: string,
): AnthropicStreamEventData {
  return {
    type: "content_block_delta",
    index,
    delta: {
      type: "input_json_delta",
      partial_json: partialJson,
    },
  }
}

function resolveOutputIndex(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): number | undefined {
  const direct = getNumber(event.output_index)
  if (direct !== undefined) return direct

  const itemId = getString(event.item_id)
  if (!itemId) return undefined
  for (const block of state.blocksByOutputIndex.values()) {
    if (block.itemId === itemId || block.toolCallId === itemId) {
      return block.outputIndex
    }
  }
  return undefined
}

function errorEvent(message: string): AnthropicStreamEventData {
  return {
    type: "error",
    error: {
      type: "api_error",
      message,
    },
  }
}

function getResponse(
  event: Record<string, unknown>,
): ResponsesResult | undefined {
  const response = getRecord(event.response)
  if (
    !response
    || typeof response.id !== "string"
    || typeof response.model !== "string"
    || !Array.isArray(response.output)
  ) {
    return undefined
  }
  return response as unknown as ResponsesResult
}

function getErrorMessage(event: Record<string, unknown>): string | undefined {
  if (typeof event.message === "string") return event.message
  const error = getRecord(event.error)
  return error ? getString(error.message) : undefined
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ?
      (value as Record<string, unknown>)
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || value.length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
