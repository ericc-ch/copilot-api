import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  mapOpenAIStopReasonToAnthropic,
  sanitizeClaudeCodeToolInput,
} from "./utils"

type ToolCallStreamInfo = AnthropicStreamState["toolCalls"][number]

function isToolBlockOpen(state: AnthropicStreamState): boolean {
  if (!state.contentBlockOpen) {
    return false
  }

  // Check if the current block index corresponds to any known tool call
  return Object.values(state.toolCalls).some(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex,
  )
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    return JSON.parse(argumentsText) as Record<string, unknown>
  } catch {
    return {}
  }
}

function getCurrentToolCallInfo(state: AnthropicStreamState) {
  return Object.values(state.toolCalls).find(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex,
  )
}

function emitReadInputIfNeeded(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
): void {
  const toolCallInfo = getCurrentToolCallInfo(state)
  if (
    !toolCallInfo
    || toolCallInfo.name !== "Read"
    || toolCallInfo.inputEmitted
  ) {
    return
  }

  events.push({
    type: "content_block_delta",
    index: toolCallInfo.anthropicBlockIndex,
    delta: {
      type: "input_json_delta",
      partial_json: JSON.stringify(
        sanitizeClaudeCodeToolInput(
          toolCallInfo.name,
          parseToolArguments(toolCallInfo.arguments ?? "{}"),
        ),
      ),
    },
  })
  toolCallInfo.inputEmitted = true
}

function closeCurrentBlock(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
): void {
  emitReadInputIfNeeded(events, state)
  events.push({
    type: "content_block_stop",
    index: state.contentBlockIndex,
  })
  state.contentBlockOpen = false
}

function appendToolArguments(
  events: Array<AnthropicStreamEventData>,
  toolCallInfo: ToolCallStreamInfo,
  argumentsText: string,
): void {
  if (toolCallInfo.name === "Read") {
    toolCallInfo.arguments = (toolCallInfo.arguments ?? "") + argumentsText
    return
  }

  events.push({
    type: "content_block_delta",
    index: toolCallInfo.anthropicBlockIndex,
    delta: {
      type: "input_json_delta",
      partial_json: argumentsText,
    },
  })
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

  if (delta.content) {
    if (isToolBlockOpen(state)) {
      // A tool block was open, so close it before starting a text block.
      closeCurrentBlock(events, state)
      state.contentBlockIndex++
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

  if (delta.tool_calls) {
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
          arguments: toolCall.function.arguments ?? "",
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
          appendToolArguments(events, toolCallInfo, toolCall.function.arguments)
        }
      }
    }
  }

  if (choice.finish_reason) {
    if (state.contentBlockOpen) {
      closeCurrentBlock(events, state)
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
