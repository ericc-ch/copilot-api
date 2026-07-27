import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import { state } from "~/lib/state"
import { selectCopilotMessagesEndpoint } from "~/routes/messages/endpoint-selection"
import { createAnthropicMessages } from "~/services/copilot/create-anthropic-messages"

const originalFetch = globalThis.fetch

beforeEach(() => {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Copilot Messages endpoint selection", () => {
  test("prefers the native Anthropic endpoint", () => {
    expect(
      selectCopilotMessagesEndpoint(["/chat/completions", "/v1/messages"]),
    ).toBe("/v1/messages")
  })

  test("uses Chat Completions for legacy model catalogs", () => {
    expect(selectCopilotMessagesEndpoint(undefined)).toBe("/chat/completions")
    expect(selectCopilotMessagesEndpoint(["/chat/completions"])).toBe(
      "/chat/completions",
    )
  })

  test("uses Responses for Responses-only models", () => {
    expect(selectCopilotMessagesEndpoint(["/responses", "ws:/responses"])).toBe(
      "/responses",
    )
  })

  test("rejects models without a supported text endpoint", () => {
    expect(selectCopilotMessagesEndpoint(["/embeddings"])).toBeNull()
  })
})

test("forwards Anthropic payloads unchanged to the native endpoint", async () => {
  const payload: AnthropicMessagesPayload = {
    model: "claude-sonnet-5",
    system: "Retain this system context.",
    messages: [
      { role: "user", content: "Complete the prefix." },
      { role: "assistant", content: "PREFIX:" },
    ],
    max_tokens: 64,
    stream: true,
    thinking: {
      type: "enabled",
      budget_tokens: 32,
    },
  }
  const upstreamResponse = new Response("native response", {
    headers: { "content-type": "text/event-stream" },
  })
  const fetchMock = mock(
    (_url: string | URL | Request, _options?: RequestInit) =>
      Promise.resolve(upstreamResponse),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch

  const response = await createAnthropicMessages(
    payload,
    {
      "anthropic-beta": "interleaved-thinking-2025-05-14",
      "anthropic-version": "2023-06-01",
    },
    "?beta=true",
  )

  expect(response).toBe(upstreamResponse)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe("https://api.githubcopilot.com/v1/messages?beta=true")
  expect(typeof options?.body).toBe("string")
  expect(JSON.parse(options?.body as string)).toEqual(payload)
  const headers = options?.headers as Record<string, string>
  expect(headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14")
  expect(headers["anthropic-version"]).toBe("2023-06-01")
  expect(headers["X-Initiator"]).toBe("agent")
})
