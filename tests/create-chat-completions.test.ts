import { test, expect, mock } from "bun:test"

import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

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
  const lastCall = fetchMock.mock.calls.at(-1)
  const headers = (lastCall?.[1] as { headers: Record<string, string> }).headers
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
  const lastCall = fetchMock.mock.calls.at(-1)
  const headers = (lastCall?.[1] as { headers: Record<string, string> }).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("forwards max_completion_tokens for gpt-5.4 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
    max_completion_tokens: 128,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls.at(-1)?.[1] as { body?: string }).body ?? "{}",
  ) as ChatCompletionsPayload

  expect(body.max_tokens).toBeUndefined()
  expect(body.max_completion_tokens).toBe(128)
})

test("maps legacy max_tokens to max_completion_tokens for gpt-5.4 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4-mini",
    max_tokens: 256,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls.at(-1)?.[1] as { body?: string }).body ?? "{}",
  ) as ChatCompletionsPayload

  expect(body.max_tokens).toBeUndefined()
  expect(body.max_completion_tokens).toBe(256)
})

test("keeps max_tokens for gpt-5.2 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.2",
    max_completion_tokens: 512,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls.at(-1)?.[1] as { body?: string }).body ?? "{}",
  ) as ChatCompletionsPayload

  expect(body.max_tokens).toBe(512)
  expect(body.max_completion_tokens).toBeUndefined()
})

