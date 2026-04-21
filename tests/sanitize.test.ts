import { test, expect, describe } from "bun:test"

import type { AnthropicMessagesPayload } from "../src/routes/messages/anthropic-types"

import { sanitizePayload, isClaudeModel } from "../src/lib/sanitize"

const basePayload: AnthropicMessagesPayload = {
  model: "claude-sonnet-4",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
}

describe("isClaudeModel", () => {
  test("returns true for claude models", () => {
    expect(isClaudeModel("claude-sonnet-4")).toBe(true)
    expect(isClaudeModel("claude-opus-4")).toBe(true)
    expect(isClaudeModel("claude-haiku-3")).toBe(true)
    expect(isClaudeModel("claude-sonnet-4-20250514")).toBe(true)
  })

  test("returns false for non-claude models", () => {
    expect(isClaudeModel("gpt-4o")).toBe(false)
    expect(isClaudeModel("o1-mini")).toBe(false)
    expect(isClaudeModel("gemini-pro")).toBe(false)
  })
})

describe("sanitizePayload", () => {
  describe("model name normalization", () => {
    test("normalizes claude-sonnet-4-* to claude-sonnet-4", () => {
      const result = sanitizePayload({
        ...basePayload,
        model: "claude-sonnet-4-20250514",
      })
      expect(result.model).toBe("claude-sonnet-4")
    })

    test("normalizes claude-opus-4-* to claude-opus-4", () => {
      const result = sanitizePayload({
        ...basePayload,
        model: "claude-opus-4-20250514",
      })
      expect(result.model).toBe("claude-opus-4")
    })

    test("preserves models without version suffixes", () => {
      const result = sanitizePayload({
        ...basePayload,
        model: "claude-sonnet-4",
      })
      expect(result.model).toBe("claude-sonnet-4")
    })

    test("preserves non-claude models", () => {
      const result = sanitizePayload({ ...basePayload, model: "gpt-4o" })
      expect(result.model).toBe("gpt-4o")
    })
  })

  describe("context_management stripping", () => {
    test("strips context_management from payload", () => {
      const payload = {
        ...basePayload,
        context_management: { some: "value" },
      } as AnthropicMessagesPayload & { context_management: unknown }
      const result = sanitizePayload(payload)
      expect(
        (result as Record<string, unknown>).context_management,
      ).toBeUndefined()
    })
  })

  describe("thinking sanitization", () => {
    test("strips budget_tokens from thinking", () => {
      const result = sanitizePayload({
        ...basePayload,
        thinking: { type: "enabled", budget_tokens: 5000 },
      })
      expect(result.thinking).toEqual({ type: "enabled" })
    })

    test("converts enabled to adaptive for opus models", () => {
      const result = sanitizePayload({
        ...basePayload,
        model: "claude-opus-4-20250514",
        thinking: { type: "enabled", budget_tokens: 5000 },
      })
      expect(result.thinking).toEqual({ type: "adaptive" })
    })

    test("preserves thinking type for non-opus models", () => {
      const result = sanitizePayload({
        ...basePayload,
        model: "claude-sonnet-4",
        thinking: { type: "enabled" },
      })
      expect(result.thinking).toEqual({ type: "enabled" })
    })
  })

  describe("tools sanitization", () => {
    test("strips defer_loading from tools", () => {
      const payload = {
        ...basePayload,
        tools: [
          {
            name: "get_weather",
            input_schema: { type: "object" },
            defer_loading: true,
          } as unknown as AnthropicMessagesPayload["tools"] extends (
            Array<infer T> | undefined
          ) ?
            T
          : never,
        ],
      }
      const result = sanitizePayload(
        payload as unknown as AnthropicMessagesPayload,
      )
      expect(result.tools?.[0]).toEqual({
        name: "get_weather",
        input_schema: { type: "object" },
      })
    })
  })

  describe("tool_reference filtering", () => {
    test("filters tool_reference blocks from messages", () => {
      const result = sanitizePayload({
        ...basePayload,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              {
                type: "tool_reference" as "text",
                tool_use_id: "abc",
              },
            ],
          },
        ],
      })
      const content = result.messages[0].content as Array<{ type: string }>
      expect(content).toHaveLength(1)
      expect(content[0].type).toBe("text")
    })

    test("preserves string content messages", () => {
      const result = sanitizePayload({
        ...basePayload,
        messages: [{ role: "user", content: "Hello" }],
      })
      expect(result.messages[0].content).toBe("Hello")
    })
  })

  describe("output_config normalization for opus", () => {
    test("normalizes non-medium effort to medium for opus", () => {
      const payload = {
        ...basePayload,
        model: "claude-opus-4-20250514",
        output_config: { effort: "high" },
      } as unknown as AnthropicMessagesPayload
      const result = sanitizePayload(payload)
      expect((result as Record<string, unknown>).output_config).toEqual({
        effort: "medium",
      })
    })

    test("does not modify medium effort for opus", () => {
      const payload = {
        ...basePayload,
        model: "claude-opus-4-20250514",
        output_config: { effort: "medium" },
      } as unknown as AnthropicMessagesPayload
      const result = sanitizePayload(payload)
      // effort is already medium, so it should not be modified
      expect((result as Record<string, unknown>).output_config).toEqual({
        effort: "medium",
      })
    })
  })

  describe("does not mutate original payload", () => {
    test("returns a new object", () => {
      const original = { ...basePayload }
      const result = sanitizePayload(original)
      expect(result).not.toBe(original)
    })
  })
})
