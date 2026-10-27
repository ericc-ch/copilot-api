import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { shouldUseNativeMessages } from "~/routes/messages/native-handler"
import { server } from "~/server"
import {
  createNativeMessages,
  type NativeMessagesPayload,
} from "~/services/copilot/create-native-messages"
import { thinkingTypeReplacements } from "~/services/copilot/thinking-type"

import {
  ENABLED_REJECTED,
  errorBody,
  OPUS_DISABLED_REJECTED,
} from "./fixtures/thinking-errors"

interface FetchInit {
  headers: Record<string, string>
  body: string
}

const realFetch = globalThis.fetch
let calls: Array<{ url: string; init: FetchInit }> = []

function mockFetch(...responses: Array<Response>): void {
  calls = []
  const fetchMock = mock((url: string, init: FetchInit) => {
    calls.push({ url, init })
    return Promise.resolve(responses[calls.length - 1])
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function rejection(message: string): Response {
  return new Response(errorBody(message), {
    status: 400,
    headers: { "content-type": "application/json" },
  })
}

function sentBody(index: number): Record<string, unknown> {
  return JSON.parse(calls[index].init.body) as Record<string, unknown>
}

function payload(thinkingType: string): NativeMessagesPayload {
  return {
    model: "claude-opus-5-5",
    messages: [{ role: "user", content: "hi" }],
    thinking: { type: thinkingType },
    output_config: { effort: "high" },
  }
}

function requestMessages(body: unknown): Promise<Response> {
  return Promise.resolve(
    server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
  state.nativeMessages = true
  thinkingTypeReplacements.clear()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("createNativeMessages", () => {
  test("forwards the payload and the beta header unchanged", async () => {
    mockFetch(jsonResponse({ type: "message" }))
    const body = { ...payload("adaptive"), max_tokens: 16 }
    await createNativeMessages(body, {
      "anthropic-beta": "context-1m-2025-08-07",
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.githubcopilot.com/v1/messages")
    expect(sentBody(0)).toEqual(body)
    expect(calls[0].init.headers["anthropic-beta"]).toBe(
      "context-1m-2025-08-07",
    )
    expect(calls[0].init.headers["X-Initiator"]).toBe("user")
  })

  test("retries once with the accepted type and caches it after success", async () => {
    mockFetch(
      rejection(OPUS_DISABLED_REJECTED),
      jsonResponse({ type: "message" }),
      jsonResponse({ type: "message" }),
    )
    const original = payload("disabled")
    await createNativeMessages(original, {})
    expect(calls).toHaveLength(2)
    expect(sentBody(1).thinking).toEqual({ type: "adaptive" })
    expect(sentBody(1).output_config).toEqual({ effort: "high" })
    expect(original.thinking).toEqual({ type: "disabled" })

    await createNativeMessages(payload("disabled"), {})
    expect(calls).toHaveLength(3)
    expect(sentBody(2).thinking).toEqual({ type: "adaptive" })
  })

  test("does not cache the accepted type when the retry fails", async () => {
    mockFetch(
      rejection(OPUS_DISABLED_REJECTED),
      rejection("Another problem."),
      rejection(OPUS_DISABLED_REJECTED),
      jsonResponse({ type: "message" }),
    )
    const failed = await createNativeMessages(payload("disabled"), {}).catch(
      (error: unknown) => error,
    )
    expect(failed).toBeInstanceOf(HTTPError)

    await createNativeMessages(payload("disabled"), {})
    expect(calls).toHaveLength(4)
    expect(sentBody(2).thinking).toEqual({ type: "disabled" })
  })

  test("keeps thinking.display and drops budget_tokens in the retry", async () => {
    mockFetch(rejection(ENABLED_REJECTED), jsonResponse({ type: "message" }))
    const body = {
      ...payload("enabled"),
      thinking: { type: "enabled", budget_tokens: 1024, display: "summarized" },
    }
    await createNativeMessages(body, {})
    expect(sentBody(1).thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    })
  })

  test("replaces a cached type that Copilot rejects later", async () => {
    mockFetch(
      rejection(OPUS_DISABLED_REJECTED),
      jsonResponse({ type: "message" }),
      rejection(
        '"thinking.type.adaptive" is not supported for this model. Use "thinking.type.between_tools" instead.',
      ),
      jsonResponse({ type: "message" }),
      jsonResponse({ type: "message" }),
    )
    await createNativeMessages(payload("disabled"), {})
    await createNativeMessages(payload("disabled"), {})
    await createNativeMessages(payload("disabled"), {})
    expect(calls).toHaveLength(5)
    expect(sentBody(2).thinking).toEqual({ type: "adaptive" })
    expect(sentBody(3).thinking).toEqual({ type: "between_tools" })
    expect(sentBody(4).thinking).toEqual({ type: "between_tools" })
  })

  test("does not retry other errors", async () => {
    mockFetch(jsonResponse({ type: "error" }, 429))
    const failed = await createNativeMessages(payload("disabled"), {}).catch(
      (error: unknown) => error,
    )
    expect(failed).toBeInstanceOf(HTTPError)
    expect(calls).toHaveLength(1)
  })

  test("marks agent calls and images inside tool results", async () => {
    mockFetch(jsonResponse({ type: "message" }))
    await createNativeMessages(
      {
        model: "claude-opus-5-5",
        messages: [
          { role: "user", content: "Read a.png." },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "image", source: {} }],
              },
            ],
          },
        ],
      },
      {},
    )
    expect(calls[0].init.headers["X-Initiator"]).toBe("agent")
    expect(calls[0].init.headers["copilot-vision-request"]).toBe("true")
  })
})

describe("shouldUseNativeMessages", () => {
  const userTurn = [{ role: "user", content: "hi" }]

  test("selects Claude models", () => {
    expect(
      shouldUseNativeMessages({ model: "claude-opus-5", messages: userTurn }),
    ).toBe(true)
    expect(
      shouldUseNativeMessages({ model: "gpt-4.1", messages: userTurn }),
    ).toBe(false)
  })

  test("keeps the translation path for a trailing assistant prefill", () => {
    expect(
      shouldUseNativeMessages({
        model: "claude-opus-5",
        messages: [...userTurn, { role: "assistant", content: "{" }],
      }),
    ).toBe(false)
  })

  test("follows the native-messages option", () => {
    state.nativeMessages = false
    expect(
      shouldUseNativeMessages({ model: "claude-opus-5", messages: userTurn }),
    ).toBe(false)
  })
})

describe("POST /v1/messages", () => {
  test("streams the native response to the client unchanged", async () => {
    const events = 'event: message_start\ndata: {"type":"message_start"}\n\n'
    mockFetch(
      new Response(events, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      }),
    )
    const body = { ...payload("adaptive"), max_tokens: 16, stream: true }
    const response = await requestMessages(body)
    expect(calls[0].url).toEndWith("/v1/messages")
    expect(sentBody(0)).toEqual(body)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(await response.text()).toBe(events)
  })

  test("returns upstream errors with status, body and retry-after", async () => {
    mockFetch(
      new Response('{"type":"error"}', {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "7",
          "x-should-retry": "true",
        },
      }),
    )
    const response = await requestMessages({
      ...payload("adaptive"),
      max_tokens: 16,
    })
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("7")
    expect(response.headers.get("x-should-retry")).toBe("true")
    expect(await response.text()).toBe('{"type":"error"}')
  })

  test("sends other models through /chat/completions", async () => {
    mockFetch(
      jsonResponse({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "gpt-4.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi" },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    const response = await requestMessages({
      model: "gpt-4.1",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    })
    expect(calls[0].url).toEndWith("/chat/completions")
    expect(response.status).toBe(200)
  })
})
