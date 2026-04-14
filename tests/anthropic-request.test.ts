import { describe, test, expect } from "bun:test"
import { z } from "zod"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import type { Model } from "../src/services/copilot/get-models"

import { translateToOpenAI } from "../src/routes/messages/non-stream-translation"
import {
  buildAnthropicReasoningContext,
  buildOpenAIReasoningContext,
} from "../src/routes/reasoning-context"

function makeModel(
  id: string,
  supports: Model["capabilities"]["supports"],
): Model {
  return {
    id,
    model_picker_enabled: true,
    name: id,
    object: "model",
    preview: false,
    vendor: "test",
    version: "1",
    capabilities: {
      family: id,
      limits: {},
      object: "model_capabilities",
      supports,
      tokenizer: "test",
      type: "chat",
    },
  }
}

const disabledReasoningContext = {
  reasoningEffort: undefined,
  thinkingBudget: undefined,
}

// Zod schema for a single message in the chat completion request.
const messageSchema = z.object({
  role: z.enum([
    "system",
    "user",
    "assistant",
    "tool",
    "function",
    "developer",
  ]),
  content: z.union([z.string(), z.object({}), z.array(z.any())]),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
})

// Zod schema for the entire chat completion request payload.
// This is derived from the openapi.documented.yml specification.
const chatCompletionRequestSchema = z.object({
  messages: z.array(messageSchema).min(1, "Messages array cannot be empty."),
  model: z.string(),
  frequency_penalty: z.number().min(-2).max(2).optional().nullable(),
  logit_bias: z.record(z.string(), z.number()).optional().nullable(),
  logprobs: z.boolean().optional().nullable(),
  top_logprobs: z.number().int().min(0).max(20).optional().nullable(),
  max_tokens: z.number().int().optional().nullable(),
  n: z.number().int().min(1).max(128).optional().nullable(),
  presence_penalty: z.number().min(-2).max(2).optional().nullable(),
  response_format: z
    .object({
      type: z.enum(["text", "json_object", "json_schema"]),
      json_schema: z.object({}).optional(),
    })
    .optional(),
  seed: z.number().int().optional().nullable(),
  stop: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .nullable(),
  stream: z.boolean().optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  top_p: z.number().min(0).max(1).optional().nullable(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.union([z.string(), z.object({})]).optional(),
  user: z.string().optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  thinking_budget: z.number().int().optional(),
})

/**
 * Validates if a request payload conforms to the OpenAI Chat Completion v1 shape using Zod.
 * @param payload The request payload to validate.
 * @returns True if the payload is valid, false otherwise.
 */
function isValidChatCompletionRequest(payload: unknown): boolean {
  const result = chatCompletionRequestSchema.safeParse(payload)
  return result.success
}

// eslint-disable-next-line max-lines-per-function
describe("Anthropic to OpenAI translation logic", () => {
  test("should translate minimal Anthropic payload to valid OpenAI payload", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 0,
    }

    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)
  })

  test("should translate comprehensive Anthropic payload to valid OpenAI payload", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: "What is the weather like in Boston?" },
        {
          role: "assistant",
          content: "The weather in Boston is sunny and 75°F.",
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1,
      stream: false,
      metadata: { user_id: "user-123" },
      tools: [
        {
          name: "getWeather",
          description: "Gets weather info",
          input_schema: { location: { type: "string" } },
        },
      ],
      tool_choice: { type: "auto" },
    }
    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)
  })

  test("should handle missing fields gracefully", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 0,
    }
    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)
  })

  test("should handle invalid types in Anthropic payload", () => {
    const anthropicPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 0,
      temperature: "hot", // Should be a number
    } as unknown as AnthropicMessagesPayload
    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    // Should fail validation
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(false)
  })

  test("should handle thinking blocks in assistant messages", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think about this simple math problem...",
            },
            { type: "text", text: "2+2 equals 4." },
          ],
        },
      ],
      max_tokens: 100,
    }
    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)

    // Check that thinking content is combined with text content
    const assistantMessage = openAIPayload.messages.find(
      (m) => m.role === "assistant",
    )
    expect(assistantMessage?.content).toContain(
      "Let me think about this simple math problem...",
    )
    expect(assistantMessage?.content).toContain("2+2 equals 4.")
  })

  test("should handle thinking blocks with tool calls", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking:
                "I need to call the weather API to get current weather information.",
            },
            { type: "text", text: "I'll check the weather for you." },
            {
              type: "tool_use",
              id: "call_123",
              name: "get_weather",
              input: { location: "New York" },
            },
          ],
        },
      ],
      max_tokens: 100,
    }
    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)

    // Check that thinking content is included in the message content
    const assistantMessage = openAIPayload.messages.find(
      (m) => m.role === "assistant",
    )
    expect(assistantMessage?.content).toContain(
      "I need to call the weather API",
    )
    expect(assistantMessage?.content).toContain(
      "I'll check the weather for you.",
    )
    expect(assistantMessage?.tool_calls).toHaveLength(1)
    expect(assistantMessage?.tool_calls?.[0].function.name).toBe("get_weather")
  })

  test("enabled thinking maps to reasoning effort and thinking budget", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Think carefully." }],
      max_tokens: 256,
      thinking: { type: "enabled", budget_tokens: 2048 },
    }

    const openAIPayload = translateToOpenAI(anthropicPayload, {
      reasoningEffort: "high",
      thinkingBudget: 2048,
    })

    expect(openAIPayload.reasoning_effort).toBe("high")
    expect(openAIPayload.thinking_budget).toBe(2048)
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)
  })

  test("disabled thinking omits reasoning fields", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Answer directly." }],
      max_tokens: 256,
      thinking: { type: "disabled" },
    }

    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )

    expect(openAIPayload.reasoning_effort).toBeUndefined()
    expect(openAIPayload.thinking_budget).toBeUndefined()
    expect(isValidChatCompletionRequest(openAIPayload)).toBe(true)
  })

  test("emits tool results before remaining user content from mixed user content arrays", () => {
    const anthropicPayload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "lookup_weather",
              input: { location: "Boston" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "72 and sunny",
            },
            {
              type: "text",
              text: "Please summarize that for me.",
            },
          ],
        },
      ],
      max_tokens: 256,
    }

    const openAIPayload = translateToOpenAI(
      anthropicPayload,
      disabledReasoningContext,
    )

    expect(openAIPayload.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "toolu_123",
            type: "function",
            function: {
              name: "lookup_weather",
              arguments: JSON.stringify({ location: "Boston" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "toolu_123",
        content: "72 and sunny",
      },
      {
        role: "user",
        content: "Please summarize that for me.",
      },
    ])
  })
})

describe("reasoning context helpers", () => {
  test("adaptive Claude model returns the expected Anthropic reasoning context", () => {
    expect(
      buildAnthropicReasoningContext(
        {
          model: "claude-sonnet-4-20250514",
          messages: [],
          max_tokens: 1024,
          thinking: { type: "enabled", budget_tokens: 2048 },
        },
        {
          id: "claude-sonnet-4-20250514",
          model_picker_enabled: true,
          name: "Claude Sonnet 4",
          object: "model",
          preview: false,
          vendor: "anthropic",
          version: "20250514",
          capabilities: {
            family: "claude",
            limits: {},
            object: "model_capabilities",
            supports: {
              adaptive_thinking: true,
              reasoning_effort: ["low", "medium", "high"],
            },
            tokenizer: "claude",
            type: "chat",
          },
        },
      ),
    ).toEqual({
      reasoningEffort: "high",
      thinkingBudget: 2048,
    })
  })

  test("reasoning_effort-only model gets reasoning_effort but no thinking_budget", () => {
    expect(
      buildAnthropicReasoningContext(
        {
          model: "gpt-5-mini",
          messages: [],
          max_tokens: 1024,
          thinking: { type: "enabled", budget_tokens: 2048 },
        },
        makeModel("gpt-5-mini", {
          reasoning_effort: ["low", "medium", "high"],
        }),
      ),
    ).toEqual({
      reasoningEffort: "high",
      thinkingBudget: undefined,
    })
  })

  test("disabled thinking returns an empty context regardless of capability", () => {
    expect(
      buildAnthropicReasoningContext(
        {
          model: "claude-sonnet-4.6",
          messages: [],
          max_tokens: 1024,
          thinking: { type: "disabled" },
        },
        makeModel("claude-sonnet-4.6", {
          adaptive_thinking: true,
          reasoning_effort: ["low", "medium", "high"],
        }),
      ),
    ).toEqual({})
  })

  test("buildOpenAIReasoningContext keeps supported fields and drops unsupported ones", () => {
    const claudeModel = makeModel("claude-sonnet-4.6", {
      adaptive_thinking: true,
      reasoning_effort: ["low", "medium", "high"],
    })
    expect(
      buildOpenAIReasoningContext(
        {
          model: "claude-sonnet-4.6",
          messages: [],
          reasoning_effort: "high",
          thinking_budget: 2048,
        },
        claudeModel,
      ),
    ).toEqual({
      reasoningEffort: "high",
      thinkingBudget: 2048,
    })

    const gptModel = makeModel("gpt-5-mini", {
      reasoning_effort: ["low", "medium", "high"],
    })
    expect(
      buildOpenAIReasoningContext(
        {
          model: "gpt-5-mini",
          messages: [],
          reasoning_effort: "high",
          thinking_budget: 2048,
        },
        gptModel,
      ),
    ).toEqual({
      reasoningEffort: "high",
      thinkingBudget: undefined,
    })

    const plainModel = makeModel("gpt-4o", {})
    expect(
      buildOpenAIReasoningContext(
        {
          model: "gpt-4o",
          messages: [],
          reasoning_effort: "high",
          thinking_budget: 2048,
        },
        plainModel,
      ),
    ).toEqual({
      reasoningEffort: undefined,
      thinkingBudget: undefined,
    })
  })

  test("unsupported model does not expose Anthropic adaptive thinking fields", () => {
    expect(
      buildAnthropicReasoningContext(
        {
          model: "mistral-large",
          messages: [],
          max_tokens: 1024,
          thinking: { type: "enabled", budget_tokens: 2048 },
        },
        {
          id: "mistral-large",
          model_picker_enabled: true,
          name: "Mistral Large",
          object: "model",
          preview: false,
          vendor: "mistral",
          version: "latest",
          capabilities: {
            family: "mistral",
            limits: {},
            object: "model_capabilities",
            supports: {},
            tokenizer: "mistral",
            type: "chat",
          },
        },
      ),
    ).toEqual({
      reasoningEffort: undefined,
      thinkingBudget: undefined,
    })
  })
})
describe("OpenAI Chat Completion v1 Request Payload Validation with Zod", () => {
  test("should return true for a minimal valid request payload", () => {
    const validPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(validPayload)).toBe(true)
  })

  test("should return true for a comprehensive valid request payload", () => {
    const validPayload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the weather like in Boston?" },
      ],
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: false,
      n: 1,
    }
    expect(isValidChatCompletionRequest(validPayload)).toBe(true)
  })

  test('should return false if the "model" field is missing', () => {
    const invalidPayload = {
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if the "messages" field is missing', () => {
    const invalidPayload = {
      model: "gpt-4o",
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if the "messages" array is empty', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if "model" is not a string', () => {
    const invalidPayload = {
      model: 12345,
      messages: [{ role: "user", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if "messages" is not an array', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: { role: "user", content: "Hello!" },
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if a message in the "messages" array is missing a "role"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test('should return false if a message in the "messages" array is missing "content"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "user" }],
    }
    // Note: Zod considers 'undefined' as missing, so this will fail as expected.
    const result = chatCompletionRequestSchema.safeParse(invalidPayload)
    expect(result.success).toBe(false)
  })

  test('should return false if a message has an invalid "role"', () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "customer", content: "Hello!" }],
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false if an optional field has an incorrect type", () => {
    const invalidPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      temperature: "hot", // Should be a number
    }
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false for a completely empty object", () => {
    const invalidPayload = {}
    expect(isValidChatCompletionRequest(invalidPayload)).toBe(false)
  })

  test("should return false for null or non-object payloads", () => {
    expect(isValidChatCompletionRequest(null)).toBe(false)
    expect(isValidChatCompletionRequest(undefined)).toBe(false)
    expect(isValidChatCompletionRequest("a string")).toBe(false)
    expect(isValidChatCompletionRequest(123)).toBe(false)
  })
})
