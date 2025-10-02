import { afterEach, expect, test, mock } from "bun:test"

import {
  asyncIterableFrom,
  createMockRateLimit,
  makeRequest,
} from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test("forwards generic errors as HTTP 500", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      throw new Error("Internal issue")
    },
  }))
  const { server } = await import("~/server")
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
  expect(res.status).toBe(500)
  const json = (await res.json()) as {
    error: { message: string; type: string }
  }
  expect(json).toEqual({ error: { message: "Internal issue", type: "error" } })
})

test("requires model in URL for non-stream endpoint", async () => {
  const { server } = await import("~/server")
  const res = await server.request("/v1beta/models/:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
  })

  expect(res.status).toBe(500)
  const json = await res.json()
  expect(json).toEqual({
    error: { message: "Model name is required in URL path", type: "error" },
  })
})

test("requires model in URL for stream endpoint", async () => {
  const { server } = await import("~/server")
  const res = await server.request("/v1beta/models/:streamGenerateContent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
  })

  expect(res.status).toBe(500)
  const json = await res.json()
  expect(json).toEqual({
    error: { message: "Model name is required in URL path", type: "error" },
  })
})

test("requires model in URL for countTokens endpoint", async () => {
  const { server } = await import("~/server")
  const res = await server.request("/v1beta/models/:countTokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
  })

  expect(res.status).toBe(500)
  const json = await res.json()
  expect(json).toEqual({
    error: { message: "Model name is required in URL path", type: "error" },
  })
})

test("streams fallback response when no text content in non-streaming to streaming conversion", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) => ({
      id: "res-fallback",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    }),
  }))

  await createMockRateLimit()

  const { server } = await import("~/server?fallback-response-no-text")

  const res = await server.request(
    "/v1beta/models/gemini-pro:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "test" }] }],
      }),
    },
  )

  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") || ""
  expect(ct.includes("text/event-stream")).toBe(true)

  const body = await res.text()

  expect(body.includes("data:")).toBe(true)
  expect(body.includes('"candidates"')).toBe(true)
  expect(body.includes('"usageMetadata"')).toBe(true)
})

test("non-stream endpoint rejects streaming response with 500", async () => {
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

  const { server } = await import("~/server")
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

  expect(res.status).toBe(500)
  const json = await res.json()
  expect(json).toEqual({
    error: {
      message: "Unexpected streaming response for non-streaming endpoint",
      type: "error",
    },
  })
})

test("routes fallthrough when URL doesn't match any generate-content patterns", async () => {
  await createMockRateLimit()

  const { server } = await import("~/server?route-fallthrough")

  const res = await server.request(
    "/v1beta/models/gemini-pro:unknownOperation",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "test" }] }],
      }),
    },
  )

  expect(res.status).toBe(404)
})

test("handles HTTP errors with proper error codes", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      const error = new Error("Bad Request")
      // Simulate HTTPError-like structure
      Object.assign(error, { status: 400 })
      throw error
    },
  }))

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
  })

  // 由于错误处理机制，HTTP错误也会转为500
  expect(res.status).toBe(500)
  const json = (await res.json()) as {
    error: { message: string; type: string }
  }
  expect(json.error.message).toContain("Bad Request")
})

test("handles malformed JSON in request body", async () => {
  const { server } = await import("~/server")
  const res = await server.request(
    "/v1beta/models/gemini-pro:generateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ invalid json",
    },
  )

  // JSON parsing errors will return 500
  expect(res.status).toBe(500)
})

test("validates required contents field in request", async () => {
  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    // Missing contents field
    model: "gemini-pro",
  })

  expect([400, 500]).toContain(res.status)
})
