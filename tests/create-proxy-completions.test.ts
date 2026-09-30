import { expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import { aggregateProxyCompletionsStream } from "../src/services/copilot/create-proxy-completions"

state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"
// pre-seed the proxy base URL so no /copilot_internal/user lookup happens
state.proxyBaseUrl = "https://proxy.example.test"

const sseChunk = (choices: Array<Record<string, unknown>>) =>
  `data: ${JSON.stringify({ id: "cmpl-1", choices })}\n\n`

test("aggregates n>1 proxy completions per choice index", async () => {
  const body =
    sseChunk([
      { text: "hel", index: 0, finish_reason: null },
      { text: "wor", index: 1, finish_reason: null },
    ])
    + sseChunk([
      { text: "lo", index: 0, finish_reason: null },
      { text: "ld", index: 1, finish_reason: null },
    ])
    + sseChunk([
      { text: "", index: 0, finish_reason: "stop" },
      { text: "", index: 1, finish_reason: "length" },
    ])
    + "data: [DO"
    + "NE]\n\n"

  const fetchMock = mock(
    (_url: string, _opts?: unknown) =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
  )
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

  const result = await aggregateProxyCompletionsStream({
    model: "gpt-41-copilot",
    prompt: "x",
    n: 2,
  })

  expect(result.choices).toHaveLength(2)
  expect(result.choices[0]).toMatchObject({
    text: "hello",
    index: 0,
    finish_reason: "stop",
  })
  expect(result.choices[1]).toMatchObject({
    text: "world",
    index: 1,
    finish_reason: "length",
  })
  expect(result.id).toBe("cmpl-1")
})
