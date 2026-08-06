import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { type AnthropicStreamEventData } from "~/routes/messages/anthropic-types"
import { translateToAnthropic } from "~/routes/messages/non-stream-translation"
import {
  createAnthropicStreamState,
  finalizeAnthropicStream,
  translateChunkToAnthropicEvents,
} from "~/routes/messages/stream-translation"

const anthropicUsageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
})

const anthropicContentBlockTextSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const anthropicContentBlockToolUseSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.any()),
})

const anthropicMessageResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(
    z.union([
      anthropicContentBlockTextSchema,
      anthropicContentBlockToolUseSchema,
    ]),
  ),
  model: z.string(),
  stop_reason: z.enum(["end_turn", "max_tokens", "stop_sequence", "tool_use"]),
  stop_sequence: z.string().nullable(),
  usage: anthropicUsageSchema,
})

/**
 * Validates if a response payload conforms to the Anthropic Message shape.
 * @param payload The response payload to validate.
 * @returns True if the payload is valid, false otherwise.
 */
function isValidAnthropicResponse(payload: unknown): boolean {
  return anthropicMessageResponseSchema.safeParse(payload).success
}

const anthropicStreamEventSchema = z.looseObject({
  type: z.enum([
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]),
})

function isValidAnthropicStreamEvent(payload: unknown): boolean {
  return anthropicStreamEventSchema.safeParse(payload).success
}

describe("OpenAI to Anthropic Non-Streaming Response Translation", () => {
  test("should translate a simple text response correctly", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4o-2024-05-13",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello! How can I help you today?",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 12,
        total_tokens: 21,
      },
    }

    const anthropicResponse = translateToAnthropic(openAIResponse)

    expect(isValidAnthropicResponse(anthropicResponse)).toBe(true)

    expect(anthropicResponse.id).toBe("chatcmpl-123")
    expect(anthropicResponse.stop_reason).toBe("end_turn")
    expect(anthropicResponse.usage.input_tokens).toBe(9)
    expect(anthropicResponse.content[0].type).toBe("text")
    if (anthropicResponse.content[0].type === "text") {
      expect(anthropicResponse.content[0].text).toBe(
        "Hello! How can I help you today?",
      )
    } else {
      throw new Error("Expected text block")
    }
  })

  test("should translate a response with tool calls", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-456",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4o-2024-05-13",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_current_weather",
                  arguments: '{"location": "Boston, MA"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 20,
        total_tokens: 50,
      },
    }

    const anthropicResponse = translateToAnthropic(openAIResponse)

    expect(isValidAnthropicResponse(anthropicResponse)).toBe(true)

    expect(anthropicResponse.stop_reason).toBe("tool_use")
    expect(anthropicResponse.content[0].type).toBe("tool_use")
    if (anthropicResponse.content[0].type === "tool_use") {
      expect(anthropicResponse.content[0].id).toBe("call_abc")
      expect(anthropicResponse.content[0].name).toBe("get_current_weather")
      expect(anthropicResponse.content[0].input).toEqual({
        location: "Boston, MA",
      })
    } else {
      throw new Error("Expected tool_use block")
    }
  })

  test("should translate a response stopped due to length", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-789",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4o-2024-05-13",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "This is a very long response that was cut off...",
          },
          finish_reason: "length",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2048,
        total_tokens: 2058,
      },
    }

    const anthropicResponse = translateToAnthropic(openAIResponse)

    expect(isValidAnthropicResponse(anthropicResponse)).toBe(true)
    expect(anthropicResponse.stop_reason).toBe("max_tokens")
  })
})

describe("OpenAI to Anthropic Streaming Response Translation", () => {
  test("should translate a simple text stream correctly", () => {
    const openAIStream: Array<ChatCompletionChunk> = [
      {
        id: "cmpl-1",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-1",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: { content: "Hello" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-1",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: { content: " there" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-1",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          { index: 0, delta: {}, finish_reason: "stop", logprobs: null },
        ],
      },
    ]

    const streamState = createAnthropicStreamState()
    const translatedStream = [
      ...openAIStream.flatMap((chunk) =>
        translateChunkToAnthropicEvents(chunk, streamState),
      ),
      ...finalizeAnthropicStream(streamState),
    ]

    for (const event of translatedStream) {
      expect(isValidAnthropicStreamEvent(event)).toBe(true)
    }
  })

  test("should translate a stream with tool calls", () => {
    const openAIStream: Array<ChatCompletionChunk> = [
      {
        id: "cmpl-2",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-2",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_xyz",
                  type: "function",
                  function: { name: "get_weather", arguments: "" },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-2",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"loc' } }],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-2",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'ation": "Paris"}' } },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: "cmpl-2",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "gpt-4o-2024-05-13",
        choices: [
          { index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null },
        ],
      },
    ]

    // Streaming translation requires state
    const streamState = createAnthropicStreamState()
    const translatedStream = [
      ...openAIStream.flatMap((chunk) =>
        translateChunkToAnthropicEvents(chunk, streamState),
      ),
      ...finalizeAnthropicStream(streamState),
    ]

    for (const event of translatedStream) {
      expect(isValidAnthropicStreamEvent(event)).toBe(true)
    }
  })
})

const chunkOf = (
  delta: ChatCompletionChunk["choices"][0]["delta"],
  finish_reason: ChatCompletionChunk["choices"][0]["finish_reason"] = null,
): ChatCompletionChunk => ({
  id: "cmpl-3",
  object: "chat.completion.chunk",
  created: 1677652288,
  model: "gpt-4o-2024-05-13",
  choices: [{ index: 0, delta, finish_reason, logprobs: null }],
})

function expectNoDeltaAfterStop(events: Array<AnthropicStreamEventData>) {
  const stopped = new Set<number>()
  for (const event of events) {
    if (event.type === "content_block_stop") {
      stopped.add(event.index)
    }
    if (event.type === "content_block_delta") {
      expect(stopped.has(event.index)).toBe(false)
    }
  }
}

describe("Chat Completions stream edge cases", () => {
  test("interleaved parallel tool call deltas never target stopped blocks", () => {
    const streamState = createAnthropicStreamState()
    const events = [
      ...[
        chunkOf({ role: "assistant" }),
        chunkOf({
          tool_calls: [
            {
              index: 0,
              id: "call_a",
              type: "function",
              function: { name: "get_weather", arguments: "" },
            },
          ],
        }),
        chunkOf({
          tool_calls: [
            {
              index: 1,
              id: "call_b",
              type: "function",
              function: { name: "get_time", arguments: "" },
            },
          ],
        }),
        // Delta for the first tool call after the second one started
        chunkOf({
          tool_calls: [{ index: 0, function: { arguments: '{"city":"NY"}' } }],
        }),
        chunkOf({
          tool_calls: [{ index: 1, function: { arguments: '{"tz":"EST"}' } }],
        }),
        chunkOf({}, "tool_calls"),
      ].flatMap((chunk) => translateChunkToAnthropicEvents(chunk, streamState)),
      ...finalizeAnthropicStream(streamState),
    ]

    expectNoDeltaAfterStop(events)

    // Both tool calls got their arguments routed to their own block
    const deltasByIndex = new Map<number, string>()
    for (const event of events) {
      if (
        event.type === "content_block_delta"
        && event.delta.type === "input_json_delta"
      ) {
        deltasByIndex.set(
          event.index,
          (deltasByIndex.get(event.index) ?? "") + event.delta.partial_json,
        )
      }
    }
    expect([...deltasByIndex.values()].sort()).toEqual([
      '{"city":"NY"}',
      '{"tz":"EST"}',
    ])
    expect(events.at(-1)).toEqual({ type: "message_stop" })
  })

  test("keeps usage from a trailing usage-only chunk", () => {
    const streamState = createAnthropicStreamState()
    const usageOnlyChunk: ChatCompletionChunk = {
      id: "cmpl-4",
      object: "chat.completion.chunk",
      created: 1677652288,
      model: "gpt-4o-2024-05-13",
      choices: [],
      usage: {
        prompt_tokens: 25,
        completion_tokens: 7,
        total_tokens: 32,
        prompt_tokens_details: { cached_tokens: 5 },
      },
    }
    const events = [
      ...[
        chunkOf({ role: "assistant", content: "Hi" }),
        chunkOf({}, "stop"),
        usageOnlyChunk,
      ].flatMap((chunk) => translateChunkToAnthropicEvents(chunk, streamState)),
      ...finalizeAnthropicStream(streamState),
    ]

    expect(events.at(-2)).toEqual({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        input_tokens: 20,
        output_tokens: 7,
        cache_read_input_tokens: 5,
      },
    })
    expect(events.at(-1)).toEqual({ type: "message_stop" })
  })

  test("text after tool calls opens a fresh block", () => {
    const streamState = createAnthropicStreamState()
    const events = [
      ...[
        chunkOf({ content: "Let me check. " }),
        chunkOf({
          tool_calls: [
            {
              index: 0,
              id: "call_a",
              type: "function",
              function: { name: "get_weather", arguments: "{}" },
            },
          ],
        }),
        chunkOf({ content: "Done." }),
        chunkOf({}, "stop"),
      ].flatMap((chunk) => translateChunkToAnthropicEvents(chunk, streamState)),
      ...finalizeAnthropicStream(streamState),
    ]

    expectNoDeltaAfterStop(events)
    const textStarts = events.filter(
      (event) =>
        event.type === "content_block_start"
        && event.content_block.type === "text",
    )
    expect(textStarts).toHaveLength(2)
  })
})
