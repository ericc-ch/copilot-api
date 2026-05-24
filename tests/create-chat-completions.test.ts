import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string> }) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

function getLastHeaders(): Record<string, string> {
  return (
    fetchMock.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }
  ).headers
}

function getLastRequestBody(): Record<string, unknown> {
  const request = fetchMock.mock.calls.at(-1)?.[1] as
    | { body?: string }
    | undefined

  if (typeof request?.body !== "string") {
    throw new TypeError("Expected fetch request body")
  }

  return JSON.parse(request.body) as Record<string, unknown>
}

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
  const headers = getLastHeaders()
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
  const headers = getLastHeaders()
  expect(headers["X-Initiator"]).toBe("user")
})

test("maps max_tokens to max_completion_tokens for GPT-5 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 321,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = getLastRequestBody()

  expect(body.max_completion_tokens).toBe(321)
  expect(body.max_tokens).toBeUndefined()
})

test("maps max_tokens to max_completion_tokens for OpenAI models discovered from metadata", async () => {
  state.models = {
    object: "list",
    data: [
      {
        id: "gpt-4.1",
        object: "model",
        name: "GPT-4.1",
        preview: false,
        model_picker_enabled: true,
        vendor: "openai",
        version: "1",
        capabilities: {
          family: "openai",
          limits: {},
          object: "model_capabilities",
          supports: {},
          tokenizer: "o200k_base",
          type: "chat",
        },
      },
    ],
  }

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-4.1",
    max_tokens: 123,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = getLastRequestBody()

  expect(body.max_completion_tokens).toBe(123)
  expect(body.max_tokens).toBeUndefined()
})

test("keeps max_tokens for non OpenAI models", async () => {
  state.models = {
    object: "list",
    data: [
      {
        id: "claude-sonnet-4",
        object: "model",
        name: "Claude Sonnet 4",
        preview: false,
        model_picker_enabled: true,
        vendor: "anthropic",
        version: "1",
        capabilities: {
          family: "claude",
          limits: {},
          object: "model_capabilities",
          supports: {},
          tokenizer: "claude",
          type: "chat",
        },
      },
    ],
  }

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "claude-sonnet-4",
    max_tokens: 456,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = getLastRequestBody()

  expect(body.max_tokens).toBe(456)
  expect(body.max_completion_tokens).toBeUndefined()
})

test("keeps explicit max_completion_tokens when already present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 111,
    max_completion_tokens: 999,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = getLastRequestBody()

  expect(body.max_completion_tokens).toBe(999)
  expect(body.max_tokens).toBe(111)
})
