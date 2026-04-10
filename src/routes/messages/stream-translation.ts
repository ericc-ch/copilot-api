import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

function closeCurrentBlock(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (!state.contentBlockOpen) {
    return
  }

  events.push({
    type: "content_block_stop",
    index: state.contentBlockIndex,
  })

  state.contentBlockIndex++
  state.contentBlockOpen = false
  state.currentContentBlockType = undefined
}

function ensureTextBlock(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (state.currentContentBlockType === "text") {
    return
  }

  closeCurrentBlock(state, events)

  events.push({
    type: "content_block_start",
    index: state.contentBlockIndex,
    content_block: {
      type: "text",
      text: "",
    },
  })

  state.contentBlockOpen = true
  state.currentContentBlockType = "text"
}

function ensureThinkingBlock(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (state.currentContentBlockType === "thinking") {
    return
  }

  closeCurrentBlock(state, events)

  events.push({
    type: "content_block_start",
    index: state.contentBlockIndex,
    content_block: {
      type: "thinking",
      thinking: "",
    },
  })

  state.contentBlockOpen = true
  state.currentContentBlockType = "thinking"
}

// eslint-disable-next-line max-lines-per-function, complexity
export function translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []

  if (chunk.choices.length === 0) {
    return events
  }

  const choice = chunk.choices[0]
  const { delta } = choice

  if (!state.messageStartSent) {
    events.push({
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
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
    })
    state.messageStartSent = true
  }

  if (delta.reasoning_text) {
    ensureThinkingBlock(state, events)

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "thinking_delta",
        thinking: delta.reasoning_text,
      },
    })
  }

  if (delta.reasoning_opaque) {
    ensureThinkingBlock(state, events)

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "signature_delta",
        signature: delta.reasoning_opaque,
      },
    })
  }

  if (delta.content) {
    ensureTextBlock(state, events)

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta.content,
      },
    })
  }

  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        // New tool call starting.
        closeCurrentBlock(state, events)

        const anthropicBlockIndex = state.contentBlockIndex
        state.toolCalls[toolCall.index] = {
          id: toolCall.id,
          name: toolCall.function.name,
          anthropicBlockIndex,
        }

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
        state.contentBlockOpen = true
        state.currentContentBlockType = "tool_use"
      }

      if (toolCall.function?.arguments) {
        const toolCallInfo = state.toolCalls[toolCall.index]
        // Tool call can still be empty
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (toolCallInfo) {
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

  if (choice.finish_reason) {
    if (state.contentBlockOpen) {
      events.push({
        type: "content_block_stop",
        index: state.contentBlockIndex,
      })
      state.contentBlockOpen = false
      state.currentContentBlockType = undefined
    }

    events.push(
      {
        type: "message_delta",
        delta: {
          stop_reason: mapOpenAIStopReasonToAnthropic(choice.finish_reason),
          stop_sequence: null,
        },
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0)
            - (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: chunk.usage?.completion_tokens ?? 0,
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens
            !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
      {
        type: "message_stop",
      },
    )
  }

  return events
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
