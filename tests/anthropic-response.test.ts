import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { type AnthropicStreamState } from "~/routes/messages/anthropic-types"
import { translateToAnthropic } from "~/routes/messages/non-stream-translation"
import { translateChunkToAnthropicEvents } from "~/routes/messages/stream-translation"

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

function createDefaultStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    currentContentBlockType: undefined,
    toolCalls: {},
  }
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

const simpleTextStream: Array<ChatCompletionChunk> = [
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
    choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
  },
]

const toolCallStream: Array<ChatCompletionChunk> = [
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

const reasoningStream: Array<ChatCompletionChunk> = [
  {
    id: "cmpl-3",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gemini-3.1-pro-preview",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          reasoning_text: "Considering the shortest valid reply.",
        },
        finish_reason: null,
        logprobs: null,
      },
    ],
  },
  {
    id: "cmpl-3",
    object: "chat.completion.chunk",
    created: 1677652288,
    model: "gemini-3.1-pro-preview",
    choices: [
      {
        index: 0,
        delta: {
          reasoning_opaque: "opaque-signature",
          content: "OK",
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  },
]

describe("OpenAI to Anthropic Streaming Response Translation", () => {
  test("should translate a simple text stream correctly", () => {
    const streamState = createDefaultStreamState()
    const translatedStream = simpleTextStream.flatMap((chunk) =>
      translateChunkToAnthropicEvents(chunk, streamState),
    )

    for (const event of translatedStream) {
      expect(isValidAnthropicStreamEvent(event)).toBe(true)
    }
  })

  test("should translate a stream with tool calls", () => {
    const streamState = createDefaultStreamState()
    const translatedStream = toolCallStream.flatMap((chunk) =>
      translateChunkToAnthropicEvents(chunk, streamState),
    )

    for (const event of translatedStream) {
      expect(isValidAnthropicStreamEvent(event)).toBe(true)
    }
  })

  test("should translate Gemini reasoning chunks into Anthropic thinking events", () => {
    const streamState = createDefaultStreamState()

    const translatedStream = reasoningStream.flatMap((chunk) =>
      translateChunkToAnthropicEvents(chunk, streamState),
    )

    expect(translatedStream).toEqual([
      {
        type: "message_start",
        message: {
          id: "cmpl-3",
          type: "message",
          role: "assistant",
          content: [],
          model: "gemini-3.1-pro-preview",
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "thinking",
          thinking: "",
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "thinking_delta",
          thinking: "Considering the shortest valid reply.",
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "signature_delta",
          signature: "opaque-signature",
        },
      },
      {
        type: "content_block_stop",
        index: 0,
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "text",
          text: "",
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "text_delta",
          text: "OK",
        },
      },
      {
        type: "content_block_stop",
        index: 1,
      },
      {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
      {
        type: "message_stop",
      },
    ])
  })
})
