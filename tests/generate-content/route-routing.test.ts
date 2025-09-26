import { afterEach, expect, test, mock } from "bun:test"

function asyncIterableFrom(events: Array<{ data?: string }>) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next() {
          if (i < events.length)
            return Promise.resolve({ value: events[i++], done: false })
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }
}

afterEach(() => {
  mock.restore()
})

test("routes to stream endpoint based on URL keyword", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) =>
      asyncIterableFrom([
        {
          data: JSON.stringify({
            id: "c1",
            choices: [
              { index: 0, delta: { content: "hi" }, finish_reason: null },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        },
        {
          data: JSON.stringify({
            id: "c1",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        },
        { data: "[DONE]" },
      ]),
  }))
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {},
  }))
  const { server } = await import("~/server?route-routing")
  const res = await server.request(
    "/v1beta/models/gemini-pro:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      }),
    },
  )
  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") || ""
  expect(ct.includes("text/event-stream")).toBe(true)
  const body = await res.text()
  expect(body.includes("data:")).toBe(true)
  expect(body.includes('"role":"model"')).toBe(true)
})

test("routes to countTokens endpoint based on URL keyword", async () => {
  await mock.module("~/lib/tokenizer", () => ({
    getTokenCount: (_: unknown) => ({ input: 2, output: 3 }),
  }))
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {},
  }))
  const { server } = await import("~/server?route-routing")
  const res = await server.request("/v1beta/models/gemini-pro:countTokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
  })
  expect(res.status).toBe(200)
  const json =
    (await res.json()) as import("~/routes/generate-content/types").GeminiCountTokensResponse
  expect(json).toEqual({ totalTokens: 5 })
})

test("routes to non-stream endpoint with path exclusivity", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) => ({
      id: "res-2",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  }))
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {},
  }))
  const { server } = await import("~/server?route-routing")
  const res = await server.request(
    "/v1beta/models/gemini-pro:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      }),
    },
  )
  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") || ""
  expect(ct.includes("application/json")).toBe(true)
  const json =
    (await res.json()) as import("~/routes/generate-content/types").GeminiResponse
  expect(Array.isArray(json.candidates)).toBe(true)
})

test("does NOT mis-route to non-stream endpoint", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) =>
      asyncIterableFrom([
        {
          data: JSON.stringify({
            id: "c1",
            choices: [
              { index: 0, delta: { content: "x" }, finish_reason: null },
            ],
          }),
        },
        {
          data: JSON.stringify({
            id: "c1",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        },
        { data: "[DONE]" },
      ]),
  }))
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {},
  }))
  const { server } = await import("~/server?route-routing")
  const res = await server.request(
    "/v1beta/models/gemini-pro:generateContent:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      }),
    },
  )
  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") || ""
  expect(ct.includes("text/event-stream")).toBe(true)
})
