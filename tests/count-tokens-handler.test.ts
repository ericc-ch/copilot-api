import { afterEach, describe, expect, test } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type { Model } from "~/services/copilot/get-models"

import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { translateToOpenAI } from "~/routes/messages/non-stream-translation"
import { messageRoutes } from "~/routes/messages/route"

function makeModel(id: string): Model {
  return {
    id,
    name: id,
    object: "model",
    vendor: "test",
    version: "1",
    preview: false,
    model_picker_enabled: true,
    capabilities: {
      family: id,
      object: "model_capabilities",
      type: "chat",
      tokenizer: "o200k_base",
      limits: { max_output_tokens: 4096 },
      supports: { tool_calls: true },
    },
  }
}

function setModels(...ids: Array<string>): void {
  state.models = { object: "list", data: ids.map((id) => makeModel(id)) }
}

async function countTokens(
  payload: AnthropicMessagesPayload,
  headers: Record<string, string> = {},
): Promise<number> {
  const res = await messageRoutes.request("/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  })
  const json = (await res.json()) as { input_tokens: number }
  return json.input_tokens
}

/** Re-derive the base count the handler starts from, before overhead/multiplier. */
async function baseCount(payload: AnthropicMessagesPayload): Promise<number> {
  const model = state.models?.data.find((m) => m.id === payload.model)
  if (!model) throw new Error("model not seeded for baseCount")
  const openAIPayload = translateToOpenAI(payload)
  const { input, output } = await getTokenCount(openAIPayload, model)
  return input + output
}

afterEach(() => {
  state.models = undefined
})

describe("count_tokens handler", () => {
  test("returns default count of 1 when the model is unknown", async () => {
    setModels("some-other-model")
    const result = await countTokens({
      model: "nonexistent-model",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hello there" }],
    })
    expect(result).toBe(1)
  })

  test("applies the 1.15 multiplier for claude models", async () => {
    setModels("claude-sonnet-4")
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hello there, how are you?" }],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload)
    expect(result).toBe(Math.round(base * 1.15))
  })

  test("applies the 1.03 multiplier for grok models", async () => {
    setModels("grok-code")
    const payload: AnthropicMessagesPayload = {
      model: "grok-code",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hello there, how are you?" }],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload)
    expect(result).toBe(Math.round(base * 1.03))
  })

  test("adds 346-token tool overhead for claude before the multiplier", async () => {
    setModels("claude-sonnet-4")
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 10,
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: {} },
        },
      ],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload)
    expect(result).toBe(Math.round((base + 346) * 1.15))
  })

  test("adds 480-token tool overhead for grok before the multiplier", async () => {
    setModels("grok-code")
    const payload: AnthropicMessagesPayload = {
      model: "grok-code",
      max_tokens: 10,
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: {} },
        },
      ],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload)
    expect(result).toBe(Math.round((base + 480) * 1.03))
  })

  test("skips tool overhead when an mcp__ tool is present under the claude-code beta", async () => {
    setModels("claude-sonnet-4")
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 10,
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          name: "mcp__server__do_thing",
          description: "An MCP tool",
          input_schema: { type: "object", properties: {} },
        },
      ],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload, {
      "anthropic-beta": "claude-code-20250101",
    })
    // No 346 overhead because an mcp__ tool exists under the claude-code beta
    expect(result).toBe(Math.round(base * 1.15))
  })

  test("still adds overhead for an mcp__ tool when the claude-code beta is absent", async () => {
    setModels("claude-sonnet-4")
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 10,
      messages: [{ role: "user", content: "Use a tool" }],
      tools: [
        {
          name: "mcp__server__do_thing",
          description: "An MCP tool",
          input_schema: { type: "object", properties: {} },
        },
      ],
    }
    const base = await baseCount(payload)
    const result = await countTokens(payload)
    expect(result).toBe(Math.round((base + 346) * 1.15))
  })

  test("falls back to a count of 1 when the body is not valid JSON", async () => {
    setModels("claude-sonnet-4")
    const res = await messageRoutes.request("/count_tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not valid json",
    })
    const json = (await res.json()) as { input_tokens: number }
    expect(json.input_tokens).toBe(1)
  })
})
