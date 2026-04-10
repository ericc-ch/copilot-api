import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import {
  createChatCompletions,
  normalizeCompletionTokenParam,
} from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string>; body?: string }) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
      body: opts.body,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("normalizes GPT-5 requests to max_completion_tokens", () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 123,
  }

  expect(normalizeCompletionTokenParam(payload)).toEqual({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_completion_tokens: 123,
  })
})

test("normalizes non-GPT-5 requests to max_tokens", () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-4o",
    max_completion_tokens: 321,
  }

  expect(normalizeCompletionTokenParam(payload)).toEqual({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-4o",
    max_tokens: 321,
  })
})

test("sends max_completion_tokens for GPT-5 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 64,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[2][1] as { body: string }).body,
  ) as ChatCompletionsPayload

  expect(body.max_completion_tokens).toBe(64)
  expect("max_tokens" in body).toBe(false)
})
