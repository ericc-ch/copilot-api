import {
  type ChatCompletionChunk,
  type Choice,
  type Delta,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

function isToolBlockOpen(state: AnthropicStreamState): boolean {
  if (!state.contentBlockOpen) {
    return false
  }
  // Check if the current block index corresponds to any known tool call
  return Object.values(state.toolCalls).some(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex,
  )
}

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

  handleMessageStart(state, events, chunk)

  handleThinkingText(delta, state, events)

  handleContent(delta, state, events)

  handleToolCalls(delta, state, events)

  handleFinish(choice, state, { events, chunk })

  return events
}

function handleFinish(
  choice: Choice,
  state: AnthropicStreamState,
  context: {
    events: Array<AnthropicStreamEventData>
    chunk: ChatCompletionChunk
  },
) {
  const { events, chunk } = context
  if (choice.finish_reason && choice.finish_reason.length > 0) {
    if (state.contentBlockOpen) {
      const toolBlockOpen = isToolBlockOpen(state)
      context.events.push({
        type: "content_block_stop",
        index: state.contentBlockIndex,
      })
      state.contentBlockOpen = false
      state.contentBlockIndex++
      if (!toolBlockOpen) {
        handleReasoningOpaque(choice.delta, events, state)
      }
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
}

function handleToolCalls(
  delta: Delta,
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    closeThinkingBlockIfOpen(state, events)

    handleReasoningOpaqueInToolCalls(state, events, delta)

    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        // New tool call starting.
        if (state.contentBlockOpen) {
          // Close any previously open block.
          events.push({
            type: "content_block_stop",
            index: state.contentBlockIndex,
          })
          state.contentBlockIndex++
          state.contentBlockOpen = false
        }

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
}

function handleReasoningOpaqueInToolCalls(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
  delta: Delta,
) {
  if (state.contentBlockOpen && !isToolBlockOpen(state)) {
    events.push({
      type: "content_block_stop",
      index: state.contentBlockIndex,
    })
    state.contentBlockIndex++
    state.contentBlockOpen = false
  }
  handleReasoningOpaque(delta, events, state)
}

function handleContent(
  delta: Delta,
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (delta.content && delta.content.length > 0) {
    closeThinkingBlockIfOpen(state, events)

    if (isToolBlockOpen(state)) {
      // A tool block was open, so close it before starting a text block.
      events.push({
        type: "content_block_stop",
        index: state.contentBlockIndex,
      })
      state.contentBlockIndex++
      state.contentBlockOpen = false
    }

    if (!state.contentBlockOpen) {
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: {
          type: "text",
          text: "",
        },
      })
      state.contentBlockOpen = true
    }

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta.content,
      },
    })
  }
}

function handleMessageStart(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
  chunk: ChatCompletionChunk,
) {
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
}

function handleReasoningOpaque(
  delta: Delta,
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
) {
  if (delta.reasoning_opaque && delta.reasoning_opaque.length > 0) {
    events.push(
      {
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: {
          type: "thinking",
          thinking: "",
        },
      },
      {
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "thinking_delta",
          thinking: "",
        },
      },
      {
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "signature_delta",
          signature: delta.reasoning_opaque,
        },
      },
      {
        type: "content_block_stop",
        index: state.contentBlockIndex,
      },
    )
    state.contentBlockIndex++
  }
}

function handleThinkingText(
  delta: Delta,
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
) {
  if (delta.reasoning_text && delta.reasoning_text.length > 0) {
    if (!state.thinkingBlockOpen) {
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: {
          type: "thinking",
          thinking: "",
        },
      })
      state.thinkingBlockOpen = true
    }

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "thinking_delta",
        thinking: delta.reasoning_text,
      },
    })

    if (delta.reasoning_opaque && delta.reasoning_opaque.length > 0) {
      events.push(
        {
          type: "content_block_delta",
          index: state.contentBlockIndex,
          delta: {
            type: "signature_delta",
            signature: delta.reasoning_opaque,
          },
        },
        {
          type: "content_block_stop",
          index: state.contentBlockIndex,
        },
      )
      state.contentBlockIndex++
      state.thinkingBlockOpen = false
    }
  }
}

function closeThinkingBlockIfOpen(
  state: AnthropicStreamState,
  events: Array<AnthropicStreamEventData>,
): void {
  if (state.thinkingBlockOpen) {
    events.push(
      {
        type: "content_block_delta",
        index: state.contentBlockIndex,
        delta: {
          type: "signature_delta",
          signature: "",
        },
      },
      {
        type: "content_block_stop",
        index: state.contentBlockIndex,
      },
    )
    state.contentBlockIndex++
    state.thinkingBlockOpen = false
  }
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
