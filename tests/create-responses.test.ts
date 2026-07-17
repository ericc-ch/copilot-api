import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"

import type { ResponsesPayload } from "../src/services/copilot/create-responses"

import { copilotBaseUrl } from "../src/lib/api-config"
import { state } from "../src/lib/state"
import { server } from "../src/server"
import { createResponses } from "../src/services/copilot/create-responses"

// Snapshot the pieces of global state this file mutates so they can be
// restored after every test, preventing leakage into other test files.
const originalFetch = globalThis.fetch
const originalCopilotToken = state.copilotToken
const originalVsCodeVersion = state.vsCodeVersion
const originalAccountType = state.accountType
const originalManualApprove = state.manualApprove
const originalRateLimitSeconds = state.rateLimitSeconds
const originalRateLimitWait = state.rateLimitWait
const originalLastRequestTimestamp = state.lastRequestTimestamp

beforeEach(() => {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
  state.manualApprove = false
  state.rateLimitSeconds = undefined
  state.rateLimitWait = false
  state.lastRequestTimestamp = undefined
})

afterEach(() => {
  globalThis.fetch = originalFetch
  state.copilotToken = originalCopilotToken
  state.vsCodeVersion = originalVsCodeVersion
  state.accountType = originalAccountType
  state.manualApprove = originalManualApprove
  state.rateLimitSeconds = originalRateLimitSeconds
  state.rateLimitWait = originalRateLimitWait
  state.lastRequestTimestamp = originalLastRequestTimestamp
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

interface FetchCallArgs {
  url: string
  init: NonNullable<Parameters<typeof fetch>[1]>
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function installFetchMock(responder: (call: FetchCallArgs) => Response): {
  calls: Array<FetchCallArgs>
} {
  const calls: Array<FetchCallArgs> = []
  const requestMock = mock(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const call = { url: requestUrl(input), init: init ?? {} }
      calls.push(call)
      return Promise.resolve(responder(call))
    },
  )
  const fetchMock: typeof fetch = Object.assign(requestMock, {
    preconnect: originalFetch.preconnect,
  })
  globalThis.fetch = fetchMock
  return { calls }
}

const okJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

describe("createResponses upstream request", () => {
  test("posts to the /responses endpoint and preserves the full payload verbatim", async () => {
    const fetchMock = installFetchMock(() =>
      okJsonResponse({ id: "resp_1", object: "response" }),
    )

    const payload: ResponsesPayload = {
      model: "gpt-test",
      input: "hello there",
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      temperature: 0.5,
      metadata: { foo: "bar" },
      // Forward-compat field not modelled explicitly.
      some_future_field: { nested: true },
    }

    await createResponses(payload)

    expect(fetchMock.calls).toHaveLength(1)
    const call = fetchMock.calls[0]
    expect(call.url).toBe(`${copilotBaseUrl(state)}/responses`)
    expect(call.init.method).toBe("POST")
    expect(call.init.body).toBe(JSON.stringify(payload))
    expect(new Headers(call.init.headers).get("accept-encoding")).toBe(
      "identity",
    )
  })

  test("passes the exact optional AbortSignal to fetch", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))
    const signal = new AbortController().signal

    await createResponses(
      { model: "gpt-test", input: "hello" },
      undefined,
      signal,
    )

    expect(fetchMock.calls[0].init.signal).toBe(signal)
  })
})

describe("createResponses X-Initiator", () => {
  test("sets X-Initiator to user for plain user input", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [{ role: "user", content: "hi" }],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
    ).toBe("user")
  })

  test("sets X-Initiator to user when input is omitted", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      previous_response_id: "resp_1",
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
    ).toBe("user")
  })

  test("sets X-Initiator to agent when input contains an assistant message", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "previous reply" },
      ],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
    ).toBe("agent")
  })

  test("sets X-Initiator to agent for a top-level function_call item", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [
        { role: "user", content: "hi" },
        { type: "function_call", name: "get_weather", arguments: "{}" },
      ],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
    ).toBe("agent")
  })

  test("sets X-Initiator to agent for a top-level function_call_output item", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [
        { role: "user", content: "hi" },
        { type: "function_call_output", call_id: "call_1", output: "sunny" },
      ],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
    ).toBe("agent")
  })

  for (const item of [
    { type: "custom_tool_call_output", call_id: "call_1", output: "done" },
    { type: "computer_call_output", call_id: "call_2", output: "done" },
    { type: "reasoning", summary: [] },
  ]) {
    test(`sets X-Initiator to agent for a top-level ${item.type} item`, async () => {
      const fetchMock = installFetchMock(() => okJsonResponse({}))

      await createResponses({
        model: "gpt-test",
        input: [{ role: "user", content: "hi" }, item],
      })

      expect(
        new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
      ).toBe("agent")
    })
  }

  for (const type of [
    "tool_search_output",
    "mcp_list_tools",
    "mcp_approval_request",
    "mcp_approval_response",
    "program",
    "program_output",
    "compaction",
  ]) {
    test(`sets X-Initiator to agent for a top-level ${type} item`, async () => {
      const fetchMock = installFetchMock(() => okJsonResponse({}))

      await createResponses({
        model: "gpt-test",
        input: [{ role: "user", content: "hi" }, { type }],
      })

      expect(
        new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
      ).toBe("agent")
    })
  }

  for (const type of [
    "additional_tools",
    "compaction_trigger",
    "item_reference",
  ]) {
    test(`does not classify ${type} as agent input`, async () => {
      const fetchMock = installFetchMock(() => okJsonResponse({}))

      await createResponses({
        model: "gpt-test",
        input: [{ role: "user", content: "hi" }, { type }],
      })

      expect(
        new Headers(fetchMock.calls[0].init.headers).get("X-Initiator"),
      ).toBe("user")
    })
  }
})

describe("createResponses vision and response normalization", () => {
  test("enables the vision header when input contains an input_image content part", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "what is this?" },
            { type: "input_image", image_url: "https://example.com/a.png" },
          ],
        },
      ],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get(
        "copilot-vision-request",
      ),
    ).toBe("true")
  })

  test("does not set the vision header when there is no input_image part", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [{ role: "user", content: "hi" }],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get(
        "copilot-vision-request",
      ),
    ).toBeNull()
  })

  test("enables the vision header for an image nested in tool output", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))

    await createResponses({
      model: "gpt-test",
      input: [
        {
          type: "custom_tool_call_output",
          call_id: "call_1",
          output: [
            {
              type: "container",
              content: [
                {
                  type: "input_image",
                  image_url: "https://example.com/tool-output.png",
                },
              ],
            },
          ],
        },
      ],
    })

    expect(
      new Headers(fetchMock.calls[0].init.headers).get(
        "copilot-vision-request",
      ),
    ).toBe("true")
  })

  test("returns a normalized non-success upstream response", async () => {
    const errorBody = { error: { message: "bad request", type: "invalid" } }
    installFetchMock(
      () =>
        new Response(JSON.stringify(errorBody), {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "content-encoding": "gzip",
            "content-length": "99",
            "content-type": "application/json",
            "retry-after": "5",
          },
        }),
    )

    const response = await createResponses({
      model: "gpt-test",
      input: "hi",
    })

    expect(response.status).toBe(400)
    expect(response.statusText).toBe("Bad Request")
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(response.headers.get("retry-after")).toBe("5")
    expect(await response.json()).toEqual(errorBody)
  })
})

describe("createResponses computer output vision detection", () => {
  for (const type of ["input_image", "computer_screenshot"]) {
    test(`enables the vision header for ${type} output from a computer call`, async () => {
      const fetchMock = installFetchMock(() => okJsonResponse({}))

      await createResponses({
        model: "gpt-test",
        input: [
          {
            type: "computer_call_output",
            call_id: "call_1",
            output: {
              type,
              image_url: "data:image/png;base64,aW1hZ2U=",
            },
          },
        ],
      })

      expect(
        new Headers(fetchMock.calls[0].init.headers).get(
          "copilot-vision-request",
        ),
      ).toBe("true")
    })
  }
})

describe("Responses route", () => {
  test("passes the inbound request AbortSignal to fetch", async () => {
    const fetchMock = installFetchMock(() => okJsonResponse({}))
    const request = new Request("http://localhost/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", input: "hello" }),
      signal: new AbortController().signal,
    })

    const res = await server.request(request)

    expect(res.status).toBe(200)
    expect(fetchMock.calls[0].init.signal).toBe(request.signal)
  })

  test("exposes retry and request headers through permissive CORS", async () => {
    installFetchMock(
      () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "retry-after": "5",
            "x-request-id": "req_1",
            "x-should-retry": "true",
          },
        }),
    )

    const res = await server.request("/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ model: "gpt-test", input: "hello" }),
    })

    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-expose-headers")).toBe(
      "retry-after,x-should-retry,x-request-id",
    )
  })

  test("forwards the original request body without JSON reserialization", async () => {
    const requestBody =
      `{\n`
      + `  "model": "gpt-test",\n`
      + `  "input": "hello",\n`
      + `  "future_integer": 9007199254740993\n`
      + `}`
    const fetchMock = installFetchMock(() => okJsonResponse({ id: "resp_1" }))

    const res = await server.request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    })

    expect(res.status).toBe(200)
    expect(fetchMock.calls[0].init.body).toBe(requestBody)
  })

  for (const path of ["/responses", "/v1/responses"]) {
    test(`passes through a non-streaming JSON response on ${path}`, async () => {
      const responseBody = { id: "resp_1", object: "response", output: [] }
      installFetchMock(
        () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-upstream-response": "preserved",
            },
          }),
      )

      const res = await server.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-test", input: "hello" }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("application/json")
      expect(res.headers.get("x-upstream-response")).toBe("preserved")
      expect(await res.json()).toEqual(responseBody)
    })
  }

  test("passes through a streaming SSE response including typed event lines", async () => {
    const sseBody =
      `event: response.created\n`
      + `data: {"type":"response.created","response":{"id":"resp_1"}}\n\n`
      + `event: response.output_text.delta\n`
      + `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n`
      + `event: response.completed\n`
      + `data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n`

    installFetchMock(
      () =>
        new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    )

    const res = await server.request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-test",
        input: "hello",
        stream: true,
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(await res.text()).toBe(sseBody)
  })

  test("removes stale compression headers from a successful response", async () => {
    installFetchMock(
      () =>
        new Response("already decompressed", {
          status: 200,
          headers: {
            "content-encoding": "gzip",
            "content-length": "42",
            "content-type": "text/plain",
            "x-request-id": "req_success",
          },
        }),
    )

    const res = await server.request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", input: "hello" }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(res.headers.get("content-length")).toBeNull()
    expect(res.headers.get("x-request-id")).toBe("req_success")
    expect(await res.text()).toBe("already decompressed")
  })

  test("transparently preserves a structured upstream error", async () => {
    const errorBody = {
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    }
    installFetchMock(
      () =>
        new Response(JSON.stringify(errorBody), {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "content-type": "application/json",
            "retry-after": "30",
            "x-request-id": "req_error",
          },
        }),
    )

    const res = await server.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", input: "hello" }),
    })

    expect(res.status).toBe(429)
    expect(res.statusText).toBe("Too Many Requests")
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(res.headers.get("retry-after")).toBe("30")
    expect(res.headers.get("x-request-id")).toBe("req_error")
    expect(await res.json()).toEqual(errorBody)
  })

  test("transparently preserves an upstream SSE error body", async () => {
    const errorBody =
      `event: error\n` + `data: {"type":"error","code":"server_error"}\n\n`
    installFetchMock(
      () =>
        new Response(errorBody, {
          status: 503,
          headers: {
            "content-type": "text/event-stream",
            "retry-after": "10",
          },
        }),
    )

    const res = await server.request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-test",
        input: "hello",
        stream: true,
      }),
    })

    expect(res.status).toBe(503)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(res.headers.get("retry-after")).toBe("10")
    expect(await res.text()).toBe(errorBody)
  })
})
