import type { Context } from "hono"

import { test, expect, mock, beforeEach } from "bun:test"

import type { Model } from "../src/services/copilot/get-models"

import { state } from "../src/lib/state"
import { handleCompletion } from "../src/routes/chat-completions/handler"

state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

const baseModel: Model = {
  id: "gpt-test",
  name: "gpt-test",
  object: "model",
  version: "1",
  vendor: "openai",
  preview: false,
  model_picker_enabled: true,
  capabilities: {
    family: "gpt",
    object: "capabilities",
    type: "chat",
    tokenizer: "o200k_base",
    limits: { max_output_tokens: 4096 },
    supports: {},
  },
}

// The real /models endpoint lists some entries WITHOUT capabilities,
// e.g. "gpt-41-copilot" or "trajectory-compaction"
const ghostModel: Model = {
  id: "gpt-ghost",
  name: "gpt-ghost",
  object: "model",
  version: "1",
  vendor: "openai",
  preview: false,
  model_picker_enabled: true,
}

interface CapturedRequestInit {
  body?: string
}

const fetchMock = mock((_url: string, _opts?: CapturedRequestInit) => ({
  ok: true,
  json: () =>
    Promise.resolve({ id: "123", object: "chat.completion", choices: [] }),
}))
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

const lastForwardedPayload = (): Record<string, unknown> => {
  const calls = fetchMock.mock.calls as Array<[string, CapturedRequestInit]>
  const call = calls.at(-1)
  if (!call) throw new Error("expected fetch to have been called")
  return JSON.parse(call[1].body as string) as Record<string, unknown>
}

const makeContext = (payload: Record<string, unknown>) =>
  ({
    req: { json: () => Promise.resolve(payload) },
    json: (data: unknown) => data,
  }) as unknown as Context

beforeEach(() => {
  fetchMock.mockClear()
  state.models = { object: "list", data: [baseModel, ghostModel] }
  // Pre-seed a valid session so no /models/session fetch happens here
  state.modelSession = {
    token: "test-session",
    availableModels: [],
    expiresAt: Date.now() + 60_000,
  }
})

test("forwards max_completion_tokens without injecting max_tokens", async () => {
  await handleCompletion(
    makeContext({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: 128,
    }),
  )
  const sent = lastForwardedPayload()
  expect(sent.max_completion_tokens).toBe(128)
  expect("max_tokens" in sent).toBe(false)
})

test("does not crash for a model without capabilities", async () => {
  await handleCompletion(
    makeContext({
      model: "gpt-ghost",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  const sent = lastForwardedPayload()
  expect("max_tokens" in sent).toBe(false)
})

test("still injects max_tokens from model limits when neither parameter is given", async () => {
  await handleCompletion(
    makeContext({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
    }),
  )
  const sent = lastForwardedPayload()
  expect(sent.max_tokens).toBe(4096)
})

test("explicitly-null max_completion_tokens still blocks max_tokens injection", async () => {
  await handleCompletion(
    makeContext({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: null,
    }),
  )
  const sent = lastForwardedPayload()
  expect("max_tokens" in sent).toBe(false)
})
