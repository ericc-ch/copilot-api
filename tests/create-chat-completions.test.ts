import { beforeEach, test, expect, mock } from "bun:test"

import type {
  ChatCompletionChunk,
  ChatCompletionsPayload,
} from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"

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

function getLastFetchCallOptions() {
  const lastCall = fetchMock.mock.calls.at(-1)
  expect(lastCall).toBeDefined()

  if (!lastCall) {
    throw new Error("Expected fetch to be called")
  }

  return lastCall[1] as { headers: Record<string, string>; body: string }
}

async function loadCreateChatCompletions() {
  const mod = await import("../src/services/copilot/create-chat-completions")
  return mod.createChatCompletions
}

beforeEach(() => {
  fetchMock.mockClear()
})

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const createChatCompletions = await loadCreateChatCompletions()

  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const { headers } = getLastFetchCallOptions()
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const createChatCompletions = await loadCreateChatCompletions()

  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const { headers } = getLastFetchCallOptions()
  expect(headers["X-Initiator"]).toBe("user")
})

test("forwards reasoning and stream options upstream unchanged", async () => {
  const createChatCompletions = await loadCreateChatCompletions()

  const payload = {
    messages: [{ role: "user", content: "reason" }],
    model: "gpt-test",
    reasoning_effort: "high",
    thinking_budget: 2048,
    stream_options: { include_usage: true },
  } satisfies ChatCompletionsPayload

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const { body } = getLastFetchCallOptions()
  expect(JSON.parse(body)).toEqual(payload)
})

test("ChatCompletionChunk typing accepts reasoning fields", () => {
  const chunk = {
    id: "chunk-1",
    object: "chat.completion.chunk",
    created: 123,
    model: "gpt-test",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          reasoning_text: "thinking",
          reasoning_opaque: "opaque-token",
        },
        finish_reason: null,
        logprobs: null,
      },
    ],
  } satisfies ChatCompletionChunk

  expect(chunk.choices[0]?.delta.reasoning_text).toBe("thinking")
  expect(chunk.choices[0]?.delta.reasoning_opaque).toBe("opaque-token")
})
