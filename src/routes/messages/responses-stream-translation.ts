import type {
  ResponseOutputFunctionCall,
  ResponseOutputReasoning,
  ResponseOutputWebSearchCall,
  ResponsesResult,
} from "~/services/copilot/create-responses"

import type { AnthropicStreamEventData } from "./anthropic-types"

import {
  translateResponsesToAnthropic,
  translateWebSearchCallBlocks,
} from "./responses-translation"

interface StreamBlock {
  index: number
  kind: "text" | "thinking" | "tool_use"
  outputIndex: number
  contentIndex: number
  hasDelta: boolean
  closed: boolean
  summaryIndex?: number
  itemId?: string
  toolCallId?: string
  toolName?: string
}

export interface ResponsesStreamState {
  messageStartSent: boolean
  messageCompleted: boolean
  nextBlockIndex: number
  currentBlock?: StreamBlock
  blocks: Map<string, StreamBlock>
  currentResponseId?: string
  currentModel?: string
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    messageStartSent: false,
    messageCompleted: false,
    nextBlockIndex: 0,
    blocks: new Map(),
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
      return handleThinkingDelta(event, state)
    }
    case "response.output_text.delta": {
      return handleTextDelta(event, state)
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

// A text block's identity is (output_index, content_index): one message
// output item can hold several content parts, and merging them would let
// deltas for a later part target the earlier, already-stopped block.
function blockKey(
  kind: StreamBlock["kind"],
  outputIndex: number,
  contentIndex = 0,
): string {
  return kind === "text" ?
      `text:${outputIndex}:${contentIndex}`
    : `${kind}:${outputIndex}`
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
      contentIndex: 0,
      itemId: getString(item.id),
    })
    return events
  }

  if (item.type === "function_call") {
    const block = openBlock(state, events, {
      kind: "tool_use",
      outputIndex,
      contentIndex: 0,
      itemId: getString(item.id),
      toolCallId:
        getString(item.call_id) ?? getString(item.id) ?? `tool_${outputIndex}`,
      toolName: getString(item.name) ?? "function",
    })
    const argumentsText = getString(item.arguments)
    if (argumentsText && !block.closed) {
      events.push(toolArgumentsDelta(block.index, argumentsText))
      block.hasDelta = true
    }
  }

  return events
}

function handleThinkingDelta(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const delta = getString(event.delta)
  const outputIndex = getNumber(event.output_index) ?? 0
  if (!delta) return events

  const block = openBlock(state, events, {
    kind: "thinking",
    outputIndex,
    contentIndex: 0,
  })
  if (block.closed) return events

  // Separate summary parts the way the non-stream translation joins them.
  const summaryIndex = getNumber(event.summary_index) ?? 0
  const needsSeparator =
    block.hasDelta
    && block.summaryIndex !== undefined
    && block.summaryIndex !== summaryIndex
  block.summaryIndex = summaryIndex

  events.push({
    type: "content_block_delta",
    index: block.index,
    delta: {
      type: "thinking_delta",
      thinking: needsSeparator ? `\n\n${delta}` : delta,
    },
  })
  block.hasDelta = true
  return events
}

function handleTextDelta(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events = ensureMessageStart(state)
  const delta = getString(event.delta)
  const outputIndex = getNumber(event.output_index) ?? 0
  const contentIndex = getNumber(event.content_index) ?? 0
  if (!delta) return events

  const block = openBlock(state, events, {
    kind: "text",
    outputIndex,
    contentIndex,
  })
  if (block.closed) return events

  events.push({
    type: "content_block_delta",
    index: block.index,
    delta: { type: "text_delta", text: delta },
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
  const contentIndex = getNumber(event.content_index) ?? 0
  const block = state.blocks.get(blockKey("text", outputIndex, contentIndex))
  if (!block || block.kind !== "text") return events

  const text = getString(event.text)
  if (!block.hasDelta && !block.closed && text) {
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
    contentIndex: 0,
  })
  if (block.closed) return events
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
    contentIndex: 0,
  })
  const argumentsText = getString(event.arguments)
  if (!block.hasDelta && !block.closed && argumentsText) {
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

  switch (item.type) {
    case "web_search_call": {
      emitWebSearchCall(
        state,
        events,
        item as unknown as ResponseOutputWebSearchCall,
      )
      break
    }
    case "reasoning": {
      events.push(
        ...handleReasoningDone(
          item as unknown as ResponseOutputReasoning,
          outputIndex,
          state,
        ),
      )
      break
    }
    case "function_call": {
      events.push(
        ...handleFunctionCallDone(
          item as unknown as ResponseOutputFunctionCall,
          outputIndex,
          state,
        ),
      )
      break
    }
    default: {
      // Message items: any of their text blocks not already stopped by
      // output_text.done is still the current block; close it.
      if (state.currentBlock?.outputIndex === outputIndex) {
        closeBlock(state, events, state.currentBlock)
      }
    }
  }
  return events
}

function handleReasoningDone(
  reasoning: ResponseOutputReasoning,
  outputIndex: number,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []
  const block = state.blocks.get(blockKey("thinking", outputIndex))
  if (!block) return events
  if (!block.hasDelta && !block.closed) {
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
  if (reasoning.encrypted_content && !block.closed) {
    events.push({
      type: "content_block_delta",
      index: block.index,
      delta: {
        type: "signature_delta",
        signature: `${reasoning.encrypted_content}@${reasoning.id}`,
      },
    })
  }
  closeBlock(state, events, block)
  return events
}

function handleFunctionCallDone(
  call: ResponseOutputFunctionCall,
  outputIndex: number,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []
  const block = state.blocks.get(blockKey("tool_use", outputIndex))
  if (!block) return events
  if (!block.hasDelta && !block.closed && call.arguments) {
    events.push(toolArgumentsDelta(block.index, call.arguments))
    block.hasDelta = true
  }
  closeBlock(state, events, block)
  return events
}

// Copilot reports web searches only as completed output items; surface
// them as the Anthropic server_tool_use / web_search_tool_result pair so
// clients see structured search activity instead of nothing.
function emitWebSearchCall(
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
  call: ResponseOutputWebSearchCall,
): void {
  const [toolUse, toolResult] = translateWebSearchCallBlocks(call)
  closeCurrentBlock(state, events)

  const toolUseIndex = state.nextBlockIndex
  state.nextBlockIndex += 1
  events.push(
    {
      type: "content_block_start",
      index: toolUseIndex,
      content_block: { ...toolUse, input: {} },
    },
    toolArgumentsDelta(toolUseIndex, JSON.stringify(toolUse.input)),
    { type: "content_block_stop", index: toolUseIndex },
  )

  const resultIndex = state.nextBlockIndex
  state.nextBlockIndex += 1
  events.push(
    {
      type: "content_block_start",
      index: resultIndex,
      content_block: toolResult,
    },
    { type: "content_block_stop", index: resultIndex },
  )
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
  details: Omit<StreamBlock, "index" | "hasDelta" | "closed">,
): StreamBlock {
  const key = blockKey(details.kind, details.outputIndex, details.contentIndex)
  const existing = state.blocks.get(key)
  if (existing) return existing

  closeCurrentBlock(state, events)
  const block: StreamBlock = {
    ...details,
    index: state.nextBlockIndex,
    hasDelta: false,
    closed: false,
  }
  state.nextBlockIndex += 1
  state.currentBlock = block
  state.blocks.set(key, block)

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
  if (block.closed || state.currentBlock?.index !== block.index) return
  events.push({ type: "content_block_stop", index: block.index })
  block.closed = true
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
  for (const block of state.blocks.values()) {
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
