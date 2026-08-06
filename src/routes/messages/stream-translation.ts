import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

type ChunkDelta = ChatCompletionChunk["choices"][0]["delta"]

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    messageCompleted: false,
    nextBlockIndex: 0,
    openBlockIndices: new Set(),
    toolCalls: {},
  }
}

// Tool blocks stay open until the stream finishes: parallel tool-call
// deltas may interleave across indices, and closing a block on the first
// switch would leave later deltas targeting a stopped block. Consumers
// address deltas by block index, so multiple open blocks are safe.
export function translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []

  // Trailing chunks may carry only usage (empty choices); keep the numbers
  // for the final message_delta.
  if (chunk.usage) {
    state.usage = chunk.usage
  }

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]

  if (!state.messageStartSent) {
    events.push(messageStartEvent(chunk))
    state.messageStartSent = true
  }

  handleContentDelta(choice.delta, state, events)
  handleToolCallDeltas(choice.delta, state, events)

  if (choice.finish_reason) {
    // Don't emit message_delta yet: usage may still arrive in a trailing
    // usage-only chunk. finalizeAnthropicStream closes out the message.
    state.stopReason = choice.finish_reason
  }

  return events
}

// Emit the closing events once the upstream stream is exhausted.
export function finalizeAnthropicStream(
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  if (!state.messageStartSent || state.messageCompleted) {
    return []
  }

  const events: Array<AnthropicStreamEventData> = []
  for (const index of [...state.openBlockIndices].sort((a, b) => a - b)) {
    events.push({ type: "content_block_stop", index })
  }
  state.openBlockIndices.clear()
  state.textBlockIndex = undefined

  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: mapOpenAIStopReasonToAnthropic(state.stopReason ?? "stop"),
        stop_sequence: null,
      },
      usage: {
        input_tokens:
          (state.usage?.prompt_tokens ?? 0)
          - (state.usage?.prompt_tokens_details?.cached_tokens ?? 0),
        output_tokens: state.usage?.completion_tokens ?? 0,
        ...(state.usage?.prompt_tokens_details?.cached_tokens !== undefined && {
          cache_read_input_tokens:
            state.usage.prompt_tokens_details.cached_tokens,
        }),
      },
    },
    {
      type: "message_stop",
    },
  )
  state.messageCompleted = true
  return events
}

function messageStartEvent(
  chunk: ChatCompletionChunk,
): AnthropicStreamEventData {
  return {
    type: "message_start",
    message: {
      id: chunk.id,
      type: "message",
      role: "assistant",
      content: [],
      model: chunk.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens:
          (chunk.usage?.prompt_tokens ?? 0)
          - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
        output_tokens: 0, // Will be updated in message_delta when finished
        ...(chunk.usage?.prompt_tokens_details?.cached_tokens !== undefined && {
          cache_read_input_tokens:
            chunk.usage.prompt_tokens_details.cached_tokens,
        }),
      },
    },
  }
}

function handleContentDelta(
  delta: ChunkDelta,
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (!delta.content) return

  if (state.textBlockIndex === undefined) {
    state.textBlockIndex = state.nextBlockIndex
    state.nextBlockIndex += 1
    state.openBlockIndices.add(state.textBlockIndex)
    events.push({
      type: "content_block_start",
      index: state.textBlockIndex,
      content_block: {
        type: "text",
        text: "",
      },
    })
  }

  events.push({
    type: "content_block_delta",
    index: state.textBlockIndex,
    delta: {
      type: "text_delta",
      text: delta.content,
    },
  })
}

function handleToolCallDeltas(
  delta: ChunkDelta,
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (!delta.tool_calls) return

  for (const toolCall of delta.tool_calls) {
    if (toolCall.id && toolCall.function?.name) {
      // New tool call starting. Close the text block so any later text
      // opens a fresh block after the tools, preserving order.
      closeTextBlock(state, events)

      const anthropicBlockIndex = state.nextBlockIndex
      state.nextBlockIndex += 1
      state.toolCalls[toolCall.index] = {
        id: toolCall.id,
        name: toolCall.function.name,
        anthropicBlockIndex,
      }
      state.openBlockIndices.add(anthropicBlockIndex)

      events.push({
        type: "content_block_start",
        index: anthropicBlockIndex,
        content_block: {
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: {},
        },
      })
    }

    if (toolCall.function?.arguments) {
      const toolCallInfo = state.toolCalls[toolCall.index]
      // Arguments may arrive before the id/name chunk for this index
      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        toolCallInfo
        && state.openBlockIndices.has(toolCallInfo.anthropicBlockIndex)
      ) {
        events.push({
          type: "content_block_delta",
          index: toolCallInfo.anthropicBlockIndex,
          delta: {
            type: "input_json_delta",
            partial_json: toolCall.function.arguments,
          },
        })
      }
    }
  }
}

function closeTextBlock(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (state.textBlockIndex === undefined) return
  events.push({
    type: "content_block_stop",
    index: state.textBlockIndex,
  })
  state.openBlockIndices.delete(state.textBlockIndex)
  state.textBlockIndex = undefined
}

export function translateErrorToAnthropicErrorEvent(): AnthropicStreamEventData {
  return {
    type: "error",
    error: {
      type: "api_error",
      message: "An unexpected error occurred during streaming.",
    },
  }
}
