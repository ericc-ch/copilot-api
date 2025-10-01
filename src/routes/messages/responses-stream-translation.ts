import { type ResponsesResult } from "~/services/copilot/create-responses"

import { type AnthropicStreamEventData } from "./anthropic-types"
import { translateResponsesResultToAnthropic } from "./responses-translation"

export interface ResponsesStreamState {
  messageStartSent: boolean
  messageCompleted: boolean
  nextContentBlockIndex: number
  blockIndexByKey: Map<string, number>
  openBlocks: Set<number>
  blockHasDelta: Set<number>
  currentResponseId?: string
  currentModel?: string
  initialInputTokens?: number
  initialInputCachedTokens?: number
  functionCallStateByOutputIndex: Map<number, FunctionCallStreamState>
  functionCallOutputIndexByItemId: Map<string, number>
}

type FunctionCallStreamState = {
  blockIndex: number
  toolCallId: string
  name: string
}

export const createResponsesStreamState = (): ResponsesStreamState => ({
  messageStartSent: false,
  messageCompleted: false,
  nextContentBlockIndex: 0,
  blockIndexByKey: new Map(),
  openBlocks: new Set(),
  blockHasDelta: new Set(),
  functionCallStateByOutputIndex: new Map(),
  functionCallOutputIndexByItemId: new Map(),
})

export const translateResponsesStreamEvent = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const eventType =
    typeof rawEvent.type === "string" ? rawEvent.type : undefined
  if (!eventType) {
    return []
  }

  switch (eventType) {
    case "response.created": {
      return handleResponseCreated(rawEvent, state)
    }

    case "response.reasoning_summary_text.delta": {
      return handleReasoningSummaryTextDelta(rawEvent, state)
    }

    case "response.output_text.delta": {
      return handleOutputTextDelta(rawEvent, state)
    }

    case "response.reasoning_summary_part.done": {
      return handleReasoningSummaryPartDone(rawEvent, state)
    }

    case "response.output_text.done": {
      return handleOutputTextDone(rawEvent, state)
    }

    case "response.output_item.added": {
      return handleOutputItemAdded(rawEvent, state)
    }

    case "response.output_item.done": {
      return handleOutputItemDone(rawEvent, state)
    }

    case "response.function_call_arguments.delta": {
      return handleFunctionCallArgumentsDelta(rawEvent, state)
    }

    case "response.function_call_arguments.done": {
      return handleFunctionCallArgumentsDone(rawEvent, state)
    }

    case "response.completed":
    case "response.incomplete": {
      return handleResponseCompleted(rawEvent, state)
    }

    case "response.failed": {
      return handleResponseFailed(rawEvent, state)
    }

    case "error": {
      return handleErrorEvent(rawEvent, state)
    }

    default: {
      return []
    }
  }
}

// Helper handlers to keep translateResponsesStreamEvent concise
const handleResponseCreated = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = toResponsesResult(rawEvent.response)
  if (response) {
    cacheResponseMetadata(state, response)
  }
  return ensureMessageStart(state, response)
}

const handleOutputItemAdded = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = toResponsesResult(rawEvent.response)
  const events = ensureMessageStart(state, response)

  const functionCallDetails = extractFunctionCallDetails(rawEvent, state)
  if (!functionCallDetails) {
    return events
  }

  const { outputIndex, toolCallId, name, initialArguments, itemId } =
    functionCallDetails

  if (itemId) {
    state.functionCallOutputIndexByItemId.set(itemId, outputIndex)
  }

  const blockIndex = openFunctionCallBlock(state, {
    outputIndex,
    toolCallId,
    name,
    events,
  })

  if (initialArguments !== undefined && initialArguments.length > 0) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: initialArguments,
      },
    })
    state.blockHasDelta.add(blockIndex)
  }

  return events
}

const handleOutputItemDone = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const item = isRecord(rawEvent.item) ? rawEvent.item : undefined
  if (!item) {
    return events
  }

  const itemType = typeof item.type === "string" ? item.type : undefined
  if (itemType !== "reasoning") {
    return events
  }

  const outputIndex = toNumber(rawEvent.output_index)

  const blockIndex = openThinkingBlockIfNeeded(state, outputIndex, events)

  const signature =
    typeof item.encrypted_content === "string" ? item.encrypted_content : ""

  if (signature) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "signature_delta",
        signature,
      },
    })
    state.blockHasDelta.add(blockIndex)
  }

  closeBlockIfOpen(state, blockIndex, events)

  return events
}

const handleFunctionCallArgumentsDelta = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = resolveFunctionCallOutputIndex(state, rawEvent)
  if (outputIndex === undefined) {
    return events
  }

  const deltaText = typeof rawEvent.delta === "string" ? rawEvent.delta : ""
  if (!deltaText) {
    return events
  }

  const blockIndex = openFunctionCallBlock(state, {
    outputIndex,
    events,
  })

  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: {
      type: "input_json_delta",
      partial_json: deltaText,
    },
  })
  state.blockHasDelta.add(blockIndex)

  return events
}

const handleFunctionCallArgumentsDone = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = resolveFunctionCallOutputIndex(state, rawEvent)
  if (outputIndex === undefined) {
    return events
  }

  const blockIndex = openFunctionCallBlock(state, {
    outputIndex,
    events,
  })

  const finalArguments =
    typeof rawEvent.arguments === "string" ? rawEvent.arguments : undefined

  if (!state.blockHasDelta.has(blockIndex) && finalArguments) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: finalArguments,
      },
    })
    state.blockHasDelta.add(blockIndex)
  }

  closeBlockIfOpen(state, blockIndex, events)

  const existingState = state.functionCallStateByOutputIndex.get(outputIndex)
  if (existingState) {
    state.functionCallOutputIndexByItemId.delete(existingState.toolCallId)
  }
  state.functionCallStateByOutputIndex.delete(outputIndex)

  const itemId = toNonEmptyString(rawEvent.item_id)
  if (itemId) {
    state.functionCallOutputIndexByItemId.delete(itemId)
  }

  return events
}

const handleOutputTextDelta = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = toNumber(rawEvent.output_index)
  const contentIndex = toNumber(rawEvent.content_index)
  const deltaText = typeof rawEvent.delta === "string" ? rawEvent.delta : ""

  if (!deltaText) {
    return events
  }

  const blockIndex = openTextBlockIfNeeded(state, {
    outputIndex,
    contentIndex,
    events,
  })

  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: {
      type: "text_delta",
      text: deltaText,
    },
  })
  state.blockHasDelta.add(blockIndex)

  return events
}

const handleReasoningSummaryTextDelta = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = toNumber(rawEvent.output_index)
  const deltaText = typeof rawEvent.delta === "string" ? rawEvent.delta : ""

  if (!deltaText) {
    return events
  }

  const blockIndex = openThinkingBlockIfNeeded(state, outputIndex, events)

  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: {
      type: "thinking_delta",
      thinking: deltaText,
    },
  })
  state.blockHasDelta.add(blockIndex)

  return events
}

const handleReasoningSummaryPartDone = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = toNumber(rawEvent.output_index)
  const part = isRecord(rawEvent.part) ? rawEvent.part : undefined
  const text = part && typeof part.text === "string" ? part.text : ""

  const blockIndex = openThinkingBlockIfNeeded(state, outputIndex, events)

  if (text && !state.blockHasDelta.has(blockIndex)) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "thinking_delta",
        thinking: text,
      },
    })
  }

  return events
}

const handleOutputTextDone = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = ensureMessageStart(state)

  const outputIndex = toNumber(rawEvent.output_index)
  const contentIndex = toNumber(rawEvent.content_index)
  const text = typeof rawEvent.text === "string" ? rawEvent.text : ""

  const blockIndex = openTextBlockIfNeeded(state, {
    outputIndex,
    contentIndex,
    events,
  })

  if (text && !state.blockHasDelta.has(blockIndex)) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "text_delta",
        text,
      },
    })
  }

  closeBlockIfOpen(state, blockIndex, events)

  return events
}

const handleResponseCompleted = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = toResponsesResult(rawEvent.response)
  const events = ensureMessageStart(state, response)

  closeAllOpenBlocks(state, events)

  if (response) {
    const anthropic = translateResponsesResultToAnthropic(response)
    events.push({
      type: "message_delta",
      delta: {
        stop_reason: anthropic.stop_reason,
        stop_sequence: anthropic.stop_sequence,
      },
      usage: anthropic.usage,
    })
  } else {
    events.push({
      type: "message_delta",
      delta: {
        stop_reason: null,
        stop_sequence: null,
      },
    })
  }

  events.push({ type: "message_stop" })
  state.messageCompleted = true

  return events
}

const handleResponseFailed = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = toResponsesResult(rawEvent.response)
  const events = ensureMessageStart(state, response)

  closeAllOpenBlocks(state, events)

  const message =
    typeof rawEvent.error === "string" ?
      rawEvent.error
    : "Response generation failed."

  events.push(buildErrorEvent(message))
  state.messageCompleted = true

  return events
}

const handleErrorEvent = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const message =
    typeof rawEvent.message === "string" ?
      rawEvent.message
    : "An unexpected error occurred during streaming."

  state.messageCompleted = true
  return [buildErrorEvent(message)]
}

const ensureMessageStart = (
  state: ResponsesStreamState,
  response?: ResponsesResult,
): Array<AnthropicStreamEventData> => {
  if (state.messageStartSent) {
    return []
  }

  if (response) {
    cacheResponseMetadata(state, response)
  }

  const id = response?.id ?? state.currentResponseId ?? "response"
  const model = response?.model ?? state.currentModel ?? ""

  state.messageStartSent = true

  const inputTokens =
    (state.initialInputTokens ?? 0) - (state.initialInputCachedTokens ?? 0)
  return [
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: 0,
          ...(state.initialInputCachedTokens !== undefined && {
            cache_creation_input_tokens: state.initialInputCachedTokens,
          }),
        },
      },
    },
  ]
}

const openTextBlockIfNeeded = (
  state: ResponsesStreamState,
  params: {
    outputIndex: number
    contentIndex: number
    events: Array<AnthropicStreamEventData>
  },
): number => {
  const { outputIndex, contentIndex, events } = params
  const key = getBlockKey(outputIndex, contentIndex)
  let blockIndex = state.blockIndexByKey.get(key)

  if (blockIndex === undefined) {
    blockIndex = state.nextContentBlockIndex
    state.nextContentBlockIndex += 1
    state.blockIndexByKey.set(key, blockIndex)
  }

  if (!state.openBlocks.has(blockIndex)) {
    events.push({
      type: "content_block_start",
      index: blockIndex,
      content_block: {
        type: "text",
        text: "",
      },
    })
    state.openBlocks.add(blockIndex)
  }

  return blockIndex
}

const openThinkingBlockIfNeeded = (
  state: ResponsesStreamState,
  outputIndex: number,
  events: Array<AnthropicStreamEventData>,
): number => {
  const contentIndex = 0
  const key = getBlockKey(outputIndex, contentIndex)
  let blockIndex = state.blockIndexByKey.get(key)

  if (blockIndex === undefined) {
    blockIndex = state.nextContentBlockIndex
    state.nextContentBlockIndex += 1
    state.blockIndexByKey.set(key, blockIndex)
  }

  if (!state.openBlocks.has(blockIndex)) {
    events.push({
      type: "content_block_start",
      index: blockIndex,
      content_block: {
        type: "thinking",
        thinking: "",
      },
    })
    state.openBlocks.add(blockIndex)
  }

  return blockIndex
}

const closeBlockIfOpen = (
  state: ResponsesStreamState,
  blockIndex: number,
  events: Array<AnthropicStreamEventData>,
) => {
  if (!state.openBlocks.has(blockIndex)) {
    return
  }

  events.push({ type: "content_block_stop", index: blockIndex })
  state.openBlocks.delete(blockIndex)
  state.blockHasDelta.delete(blockIndex)
}

const closeAllOpenBlocks = (
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
) => {
  for (const blockIndex of state.openBlocks) {
    closeBlockIfOpen(state, blockIndex, events)
  }

  state.functionCallStateByOutputIndex.clear()
  state.functionCallOutputIndexByItemId.clear()
}

const cacheResponseMetadata = (
  state: ResponsesStreamState,
  response: ResponsesResult,
) => {
  state.currentResponseId = response.id
  state.currentModel = response.model
  state.initialInputTokens = response.usage?.input_tokens ?? 0
  state.initialInputCachedTokens =
    response.usage?.input_tokens_details?.cached_tokens
}

const buildErrorEvent = (message: string): AnthropicStreamEventData => ({
  type: "error",
  error: {
    type: "api_error",
    message,
  },
})

const getBlockKey = (outputIndex: number, contentIndex: number): string =>
  `${outputIndex}:${contentIndex}`

const resolveFunctionCallOutputIndex = (
  state: ResponsesStreamState,
  rawEvent: Record<string, unknown>,
): number | undefined => {
  if (
    typeof rawEvent.output_index === "number"
    || (typeof rawEvent.output_index === "string"
      && rawEvent.output_index.length > 0)
  ) {
    const parsed = toOptionalNumber(rawEvent.output_index)
    if (parsed !== undefined) {
      return parsed
    }
  }

  const itemId = toNonEmptyString(rawEvent.item_id)
  if (itemId) {
    const mapped = state.functionCallOutputIndexByItemId.get(itemId)
    if (mapped !== undefined) {
      return mapped
    }
  }

  return undefined
}

const openFunctionCallBlock = (
  state: ResponsesStreamState,
  params: {
    outputIndex: number
    toolCallId?: string
    name?: string
    events: Array<AnthropicStreamEventData>
  },
): number => {
  const { outputIndex, toolCallId, name, events } = params

  let functionCallState = state.functionCallStateByOutputIndex.get(outputIndex)

  if (!functionCallState) {
    const blockIndex = state.nextContentBlockIndex
    state.nextContentBlockIndex += 1

    const resolvedToolCallId = toolCallId ?? `tool_call_${blockIndex}`
    const resolvedName = name ?? "function"

    functionCallState = {
      blockIndex,
      toolCallId: resolvedToolCallId,
      name: resolvedName,
    }

    state.functionCallStateByOutputIndex.set(outputIndex, functionCallState)
    state.functionCallOutputIndexByItemId.set(resolvedToolCallId, outputIndex)
  }

  const { blockIndex } = functionCallState

  if (!state.openBlocks.has(blockIndex)) {
    events.push({
      type: "content_block_start",
      index: blockIndex,
      content_block: {
        type: "tool_use",
        id: functionCallState.toolCallId,
        name: functionCallState.name,
        input: {},
      },
    })
    state.openBlocks.add(blockIndex)
  }

  return blockIndex
}

type FunctionCallDetails = {
  outputIndex: number
  toolCallId: string
  name: string
  initialArguments?: string
  itemId?: string
}

const extractFunctionCallDetails = (
  rawEvent: Record<string, unknown>,
  state: ResponsesStreamState,
): FunctionCallDetails | undefined => {
  const item = isRecord(rawEvent.item) ? rawEvent.item : undefined
  if (!item) {
    return undefined
  }

  const itemType = typeof item.type === "string" ? item.type : undefined
  if (itemType !== "function_call") {
    return undefined
  }

  const outputIndex = resolveFunctionCallOutputIndex(state, rawEvent)
  if (outputIndex === undefined) {
    return undefined
  }

  const callId = toNonEmptyString(item.call_id)
  const itemId = toNonEmptyString(item.id)
  const name = toNonEmptyString(item.name) ?? "function"

  const toolCallId = callId ?? itemId ?? `tool_call_${outputIndex}`
  const initialArguments =
    typeof item.arguments === "string" ? item.arguments : undefined

  return {
    outputIndex,
    toolCallId,
    name,
    initialArguments,
    itemId,
  }
}

const toResponsesResult = (value: unknown): ResponsesResult | undefined =>
  isResponsesResult(value) ? value : undefined

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  return undefined
}

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

const isResponsesResult = (value: unknown): value is ResponsesResult => {
  if (!isRecord(value)) {
    return false
  }

  if (typeof value.id !== "string") {
    return false
  }

  if (typeof value.model !== "string") {
    return false
  }

  if (!Array.isArray(value.output)) {
    return false
  }

  if (typeof value.object !== "string") {
    return false
  }

  return true
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
