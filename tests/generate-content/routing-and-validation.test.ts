import { afterEach, describe, expect, test, mock } from "bun:test"

import type { TestServer } from "./test-types"

import { makeRequest } from "./_test-utils/integration"
import {
  asyncIterableFrom,
  createMockRateLimit,
  expectSSEContains,
} from "./_test-utils/streaming"

afterEach(() => {
  mock.restore()
})

// Helper: Create server with common mocks
async function getServer(tag?: string): Promise<TestServer> {
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {},
  }))
  const { server } = (await import(tag ? `~/server?${tag}` : "~/server")) as {
    server: TestServer
  }
  return server
}

// Helper: Common request body
const defaultBody = () => ({
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
})

// Helper: Request to endpoint
async function request(
  server: TestServer,
  endpoint: string,
  body: unknown = defaultBody(),
) {
  return await server.request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

// ============================================================================
// Routing: Correct endpoint matching
// ============================================================================

describe("routing to correct endpoints", () => {
  test("routes to stream endpoint based on URL keyword", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () =>
        asyncIterableFrom([
          {
            data: JSON.stringify({
              id: "c1",
              choices: [
                { index: 0, delta: { content: "hi" }, finish_reason: null },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            }),
          },
          {
            data: JSON.stringify({
              id: "c1",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            }),
          },
          { data: "[DONE]" },
        ]),
    }))
    const server = await getServer()
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:streamGenerateContent",
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expectSSEContains(await res.text(), { jsonContains: '"role":"model"' })
  })

  test("routes to non-stream endpoint with path exclusivity", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () => ({
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
    const server = await getServer()
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:generateContent",
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const json =
      (await res.json()) as import("~/routes/generate-content/types").GeminiResponse
    expect(Array.isArray(json.candidates)).toBe(true)
  })

  test("routes to countTokens endpoint based on URL keyword", async () => {
    await mock.module("~/lib/tokenizer", () => ({
      getTokenCount: async () => Promise.resolve({ input: 2, output: 3 }),
    }))
    await mock.module("~/lib/state", () => ({
      state: {
        models: {
          data: [
            {
              id: "gemini-pro",
              capabilities: { tokenizer: "o200k_base" },
            },
          ],
        },
      },
    }))
    const server = await getServer()
    const res = await request(server, "/v1beta/models/gemini-pro:countTokens")
    expect(res.status).toBe(200)
    const json =
      (await res.json()) as import("~/routes/generate-content/types").GeminiCountTokensResponse
    expect(json).toEqual({ totalTokens: 5 })
  })

  test("does NOT mis-route", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () =>
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
    const server = await getServer()
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:generateContent:streamGenerateContent",
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("routes fallthrough when URL doesn't match patterns", async () => {
    await createMockRateLimit()
    const { server } = (await import("~/server")) as { server: TestServer }
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:unknownOperation",
      defaultBody(),
    )
    expect(res.status).toBe(404)
  })
})

// ============================================================================
// Validation: Model name required
// ============================================================================

describe("validation: model name required", () => {
  const endpoints = [
    "/v1beta/models/:generateContent",
    "/v1beta/models/:streamGenerateContent",
    "/v1beta/models/:countTokens",
  ]

  for (const endpoint of endpoints) {
    test(`requires model in URL for ${endpoint}`, async () => {
      const { server } = (await import("~/server")) as { server: TestServer }
      const res = await request(server, endpoint)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        error: { message: "Model name is required in URL path", type: "error" },
      })
    })
  }
})

// ============================================================================
// Validation: Request body validation
// ============================================================================

describe("validation: request body", () => {
  test("validates required contents field in request", async () => {
    const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
      model: "gemini-pro", // Missing contents field
    })
    expect([400, 500]).toContain(res.status)
  })

  test("handles malformed JSON in request body", async () => {
    const { server } = (await import("~/server")) as { server: TestServer }
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:generateContent",
      "{ invalid json",
    )
    expect(res.status).toBe(500)
  })
})

// ============================================================================
// Error handling
// ============================================================================

describe("error handling", () => {
  test("forwards generic errors as HTTP 500", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () => {
        throw new Error("Internal issue")
      },
    }))
    const server = await getServer()
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:streamGenerateContent",
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: { message: "Internal issue", type: "error" },
    })
  })

  test("handles HTTP errors with proper error codes", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () => {
        const error = new Error("Bad Request")
        Object.assign(error, { status: 400 })
        throw error
      },
    }))
    const res = await makeRequest(
      "/v1beta/models/gemini-pro:generateContent",
      defaultBody(),
    )
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toContain("Bad Request")
  })

  test("non-stream endpoint rejects streaming response with 500", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () =>
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
    const server = await getServer()
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:generateContent",
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: {
        message: "Unexpected streaming response for non-streaming endpoint",
        type: "error",
      },
    })
  })

  test("streams fallback response when no text content", async () => {
    await mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: () => ({
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
    const { server } = (await import("~/server")) as { server: TestServer }
    const res = await request(
      server,
      "/v1beta/models/gemini-pro:streamGenerateContent",
      {
        contents: [{ role: "user", parts: [{ text: "test" }] }],
      },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expectSSEContains(await res.text(), {
      jsonContains: '"candidates"',
      usageMetadata: true,
    })
  })
})
