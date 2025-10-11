import consola from "consola"

import {
  type ResponseCompletedEvent,
  type ResponseCreatedEvent,
  type ResponseErrorEvent,
  type ResponseFailedEvent,
  type ResponseFunctionCallArgumentsDeltaEvent,
  type ResponseFunctionCallArgumentsDoneEvent,
  type ResponseIncompleteEvent,
  type ResponseOutputItemAddedEvent,
  type ResponseOutputItemDoneEvent,
  type ResponseReasoningSummaryTextDeltaEvent,
  type ResponseReasoningSummaryTextDoneEvent,
  type ResponsesResult,
  type ResponseStreamEvent,
  type ResponseTextDeltaEvent,
  type ResponseTextDoneEvent,
} from "~/services/copilot/create-responses"

import { type AnthropicStreamEventData } from "./anthropic-types"
import { translateResponsesResultToAnthropic } from "./responses-translation"

export interface ResponsesStreamState {
  messageStartSent: boolean
  messageCompleted: boolean
  nextContentBlockIndex: number
  blockIndexByKey: Map<string, number>
  openBlocks: Set<number>
  blockHasDelta: Set<number>
  functionCallStateByOutputIndex: Map<number, FunctionCallStreamState>
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
})

export const translateResponsesStreamEvent = (
  rawEvent: ResponseStreamEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const eventType = rawEvent.type
  switch (eventType) {
    case "response.created": {
      return handleResponseCreated(rawEvent, state)
    }

    case "response.output_item.added": {
      return handleOutputItemAdded(rawEvent, state)
    }

    case "response.reasoning_summary_text.delta": {
      return handleReasoningSummaryTextDelta(rawEvent, state)
    }

    case "response.output_text.delta": {
      return handleOutputTextDelta(rawEvent, state)
    }

    case "response.reasoning_summary_text.done": {
      return handleReasoningSummaryTextDone(rawEvent, state)
    }

    case "response.output_text.done": {
      return handleOutputTextDone(rawEvent, state)
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
      consola.debug("Unknown Responses stream event type:", eventType)
      return []
    }
  }
}

// Helper handlers to keep translateResponsesStreamEvent concise
const handleResponseCreated = (
  rawEvent: ResponseCreatedEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  return messageStart(state, rawEvent.response)
}

const handleOutputItemAdded = (
  rawEvent: ResponseOutputItemAddedEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const functionCallDetails = extractFunctionCallDetails(rawEvent)
  if (!functionCallDetails) {
    return events
  }

  const { outputIndex, toolCallId, name, initialArguments } =
    functionCallDetails
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
  rawEvent: ResponseOutputItemDoneEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const item = rawEvent.item
  const itemType = item.type
  if (itemType !== "reasoning") {
    return events
  }

  const outputIndex = rawEvent.output_index
  const blockIndex = openThinkingBlockIfNeeded(state, outputIndex, events)
  const signature = (item.encrypted_content ?? "") + "@" + item.id
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

  return events
}

const handleFunctionCallArgumentsDelta = (
  rawEvent: ResponseFunctionCallArgumentsDeltaEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const outputIndex = rawEvent.output_index
  const deltaText = rawEvent.delta
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
  rawEvent: ResponseFunctionCallArgumentsDoneEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const outputIndex = rawEvent.output_index
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

  state.functionCallStateByOutputIndex.delete(outputIndex)
  return events
}

const handleOutputTextDelta = (
  rawEvent: ResponseTextDeltaEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const outputIndex = rawEvent.output_index
  const contentIndex = rawEvent.content_index
  const deltaText = rawEvent.delta

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
  rawEvent: ResponseReasoningSummaryTextDeltaEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const outputIndex = rawEvent.output_index
  const deltaText = rawEvent.delta
  const events = new Array<AnthropicStreamEventData>()
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

const handleReasoningSummaryTextDone = (
  rawEvent: ResponseReasoningSummaryTextDoneEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const outputIndex = rawEvent.output_index
  const text = rawEvent.text
  const events = new Array<AnthropicStreamEventData>()
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
  rawEvent: ResponseTextDoneEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const events = new Array<AnthropicStreamEventData>()
  const outputIndex = rawEvent.output_index
  const contentIndex = rawEvent.content_index
  const text = rawEvent.text

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

  return events
}

const handleResponseCompleted = (
  rawEvent: ResponseCompletedEvent | ResponseIncompleteEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = rawEvent.response
  const events = new Array<AnthropicStreamEventData>()

  closeAllOpenBlocks(state, events)
  const anthropic = translateResponsesResultToAnthropic(response)
  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: anthropic.stop_reason,
        stop_sequence: anthropic.stop_sequence,
      },
      usage: anthropic.usage,
    },
    { type: "message_stop" },
  )
  state.messageCompleted = true
  return events
}

const handleResponseFailed = (
  rawEvent: ResponseFailedEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const response = rawEvent.response
  const events = new Array<AnthropicStreamEventData>()
  closeAllOpenBlocks(state, events)

  const message =
    response.error?.message ?? "The response failed due to an unknown error."

  events.push(buildErrorEvent(message))
  state.messageCompleted = true

  return events
}

const handleErrorEvent = (
  rawEvent: ResponseErrorEvent,
  state: ResponsesStreamState,
): Array<AnthropicStreamEventData> => {
  const message =
    typeof rawEvent.message === "string" ?
      rawEvent.message
    : "An unexpected error occurred during streaming."

  state.messageCompleted = true
  return [buildErrorEvent(message)]
}

const messageStart = (
  state: ResponsesStreamState,
  response: ResponsesResult,
): Array<AnthropicStreamEventData> => {
  state.messageStartSent = true
  const inputCachedTokens = response.usage?.input_tokens_details?.cached_tokens
  const inputTokens =
    (response.usage?.input_tokens ?? 0) - (inputCachedTokens ?? 0)
  return [
    {
      type: "message_start",
      message: {
        id: response.id,
        type: "message",
        role: "assistant",
        content: [],
        model: response.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: 0,
          cache_read_input_tokens: inputCachedTokens ?? 0,
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
    closeOpenBlocks(state, events)
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
  //thinking blocks has multiple summary_index, should combine into one block
  const summaryIndex = 0
  const key = getBlockKey(outputIndex, summaryIndex)
  let blockIndex = state.blockIndexByKey.get(key)

  if (blockIndex === undefined) {
    blockIndex = state.nextContentBlockIndex
    state.nextContentBlockIndex += 1
    state.blockIndexByKey.set(key, blockIndex)
  }

  if (!state.openBlocks.has(blockIndex)) {
    closeOpenBlocks(state, events)
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

const closeOpenBlocks = (
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
) => {
  for (const blockIndex of state.openBlocks) {
    closeBlockIfOpen(state, blockIndex, events)
  }
}

const closeAllOpenBlocks = (
  state: ResponsesStreamState,
  events: Array<AnthropicStreamEventData>,
) => {
  closeOpenBlocks(state, events)

  state.functionCallStateByOutputIndex.clear()
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
  }

  const { blockIndex } = functionCallState

  if (!state.openBlocks.has(blockIndex)) {
    closeOpenBlocks(state, events)
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
}

const extractFunctionCallDetails = (
  rawEvent: ResponseOutputItemAddedEvent,
): FunctionCallDetails | undefined => {
  const item = rawEvent.item
  const itemType = item.type
  if (itemType !== "function_call") {
    return undefined
  }

  const outputIndex = rawEvent.output_index
  const toolCallId = item.call_id
  const name = item.name
  const initialArguments = item.arguments
  return {
    outputIndex,
    toolCallId,
    name,
    initialArguments,
  }
}
