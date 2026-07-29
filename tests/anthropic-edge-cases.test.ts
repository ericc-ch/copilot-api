import { describe, test, expect } from "bun:test"

import type {
  AnthropicMessagesPayload,
  AnthropicStreamState,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
} from "~/routes/messages/anthropic-types"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ContentPart,
} from "~/services/copilot/create-chat-completions"

import {
  translateToAnthropic,
  translateToOpenAI,
} from "../src/routes/messages/non-stream-translation"
import { translateChunkToAnthropicEvents } from "../src/routes/messages/stream-translation"

function freshStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  }
}

function makeChunk(partial: Partial<ChatCompletionChunk>): ChatCompletionChunk {
  return {
    id: "chunk-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o",
    choices: [],
    ...partial,
  }
}

describe("Anthropic request edge cases", () => {
  test("translates image blocks into image_url content parts", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgo=",
              },
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(payload)
    const userMessage = result.messages.find((m) => m.role === "user")
    expect(Array.isArray(userMessage?.content)).toBe(true)

    const parts = userMessage?.content as Array<ContentPart>
    const imagePart = parts.find((p) => p.type === "image_url")
    expect(imagePart).toBeDefined()
    if (imagePart?.type === "image_url") {
      expect(imagePart.image_url.url).toBe("data:image/png;base64,iVBORw0KGgo=")
    }
    const textPart = parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
  })

  test("translates tool_result blocks into tool role messages before user content", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      max_tokens: 100,
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { location: "Boston" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Thanks, summarize that." },
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "Sunny, 75F",
            },
          ],
        },
      ],
    }

    const result = translateToOpenAI(payload)
    const roles = result.messages.map((m) => m.role)

    // tool_result must directly follow the assistant tool_call message
    const assistantIndex = roles.indexOf("assistant")
    expect(roles[assistantIndex + 1]).toBe("tool")

    const toolMessage = result.messages[assistantIndex + 1]
    expect(toolMessage.tool_call_id).toBe("toolu_1")
    expect(toolMessage.content).toBe("Sunny, 75F")

    // remaining user text still arrives after the tool message
    expect(roles[assistantIndex + 2]).toBe("user")
  })

  test("handles multiple tool_result blocks in a single user message", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      max_tokens: 100,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_a", name: "a", input: {} },
            { type: "tool_use", id: "toolu_b", name: "b", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_a", content: "A" },
            { type: "tool_result", tool_use_id: "toolu_b", content: "B" },
          ],
        },
      ],
    }

    const result = translateToOpenAI(payload)
    const toolMessages = result.messages.filter((m) => m.role === "tool")
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual([
      "toolu_a",
      "toolu_b",
    ])
  })
})

function makeResponse(
  overrides: Partial<ChatCompletionResponse>,
): ChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [],
    ...overrides,
  } as ChatCompletionResponse
}

describe("Anthropic response edge cases", () => {
  test("does not crash on invalid tool call JSON and falls back to empty input", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          logprobs: null,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "broken_tool", arguments: "{not json" },
              },
            ],
          },
        },
      ],
    })

    const result = translateToAnthropic(response)
    const toolUse = result.content.find(
      (b): b is AnthropicToolUseBlock => b.type === "tool_use",
    )
    expect(toolUse).toBeDefined()
    expect(toolUse?.input).toEqual({})
    expect(result.stop_reason).toBe("tool_use")
  })

  test("falls back to empty input when tool arguments parse to a non-object", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          logprobs: null,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_scalar",
                type: "function",
                function: { name: "scalar_tool", arguments: "42" },
              },
            ],
          },
        },
      ],
    })

    const result = translateToAnthropic(response)
    const toolUse = result.content.find(
      (b): b is AnthropicToolUseBlock => b.type === "tool_use",
    )
    expect(toolUse?.input).toEqual({})
  })

  test("subtracts cached tokens from input_tokens and reports cache_read_input_tokens", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          logprobs: null,
          finish_reason: "stop",
          message: { role: "assistant", content: "Hi" },
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 5,
        total_tokens: 1005,
        prompt_tokens_details: { cached_tokens: 800 },
      },
    })

    const result = translateToAnthropic(response)
    expect(result.usage.input_tokens).toBe(200)
    expect(result.usage.cache_read_input_tokens).toBe(800)
    expect(result.usage.output_tokens).toBe(5)
  })

  test("omits cache_read_input_tokens when no cached token details exist", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          logprobs: null,
          finish_reason: "stop",
          message: { role: "assistant", content: "Hi" },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    })

    const result = translateToAnthropic(response)
    expect(result.usage.input_tokens).toBe(100)
    expect("cache_read_input_tokens" in result.usage).toBe(false)
  })
})

describe("Anthropic stream translation edge cases", () => {
  test("closes a text block before opening a tool block, and vice versa", () => {
    const state = freshStreamState()

    // 1. text chunk
    const textEvents = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: { role: "assistant", content: "Let me check." },
          },
        ],
      }),
      state,
    )
    expect(textEvents.map((e) => e.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
    ])

    // 2. tool call chunk: must close the text block first
    const toolEvents = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
      state,
    )
    expect(toolEvents.map((e) => e.type)).toEqual([
      "content_block_stop",
      "content_block_start",
    ])
    const blockStart = toolEvents.find((e) => e.type === "content_block_start")
    expect(
      blockStart?.type === "content_block_start"
        && blockStart.content_block.type === "tool_use"
        && blockStart.content_block.name,
    ).toBe("get_weather")

    // 3. text again after the tool block: closes tool block, opens new text block
    const backToTextEvents = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: { content: "Done." },
          },
        ],
      }),
      state,
    )
    expect(backToTextEvents.map((e) => e.type)).toEqual([
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
    ])

    // Block indices must be strictly increasing across the three blocks
    expect(state.contentBlockIndex).toBe(2)
  })

  test("streams partial tool JSON as input_json_delta tied to the right block", () => {
    const state = freshStreamState()

    translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
      state,
    )

    const argEvents = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"location":"Bo' } },
              ],
            },
          },
        ],
      }),
      state,
    )

    expect(argEvents).toHaveLength(1)
    const deltaEvent = argEvents[0]
    expect(
      deltaEvent.type === "content_block_delta"
        && deltaEvent.delta.type === "input_json_delta"
        && deltaEvent.delta.partial_json,
    ).toBe('{"location":"Bo')
  })

  test("ignores argument deltas for unknown tool call indices", () => {
    const state = freshStreamState()
    state.messageStartSent = true

    const events = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: null,
            delta: {
              tool_calls: [{ index: 7, function: { arguments: '{"x":1}' } }],
            },
          },
        ],
      }),
      state,
    )

    expect(events).toHaveLength(0)
  })

  test("reports cache-aware usage in message_delta on finish", () => {
    const state = freshStreamState()
    state.messageStartSent = true
    state.contentBlockOpen = true

    const events = translateChunkToAnthropicEvents(
      makeChunk({
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: "stop",
            delta: {},
          },
        ],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 20,
          total_tokens: 520,
          prompt_tokens_details: { cached_tokens: 300 },
        },
      }),
      state,
    )

    const messageDelta = events.find((e) => e.type === "message_delta")
    expect(messageDelta?.type).toBe("message_delta")
    if (messageDelta?.type === "message_delta") {
      expect(messageDelta.usage?.input_tokens).toBe(200)
      expect(messageDelta.usage?.cache_read_input_tokens).toBe(300)
      expect(messageDelta.usage?.output_tokens).toBe(20)
    }
    expect(events.at(-1)?.type).toBe("message_stop")
  })

  test("handles empty choices chunks without emitting events", () => {
    const state = freshStreamState()
    const events = translateChunkToAnthropicEvents(
      makeChunk({ choices: [] }),
      state,
    )
    expect(events).toHaveLength(0)
    expect(state.messageStartSent).toBe(false)
  })
})

describe("system prompt translation", () => {
  test("joins array-form system prompts into a single system message", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      max_tokens: 10,
      system: [
        { type: "text", text: "You are helpful." },
        { type: "text", text: "Be concise." },
      ] as Array<AnthropicTextBlock>,
      messages: [{ role: "user", content: "Hi" }],
    }

    const result = translateToOpenAI(payload)
    expect(result.messages[0].role).toBe("system")
    expect(result.messages[0].content).toBe("You are helpful.\n\nBe concise.")
  })
})
