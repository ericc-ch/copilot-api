import { afterEach, expect, test, mock } from "bun:test"

import type { TestServer } from "./test-types"

import { createMockChatCompletions } from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test("translates request and uses local tokenizer without downstream call", async () => {
  let downstreamCalled = false
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      downstreamCalled = true
      return {
        id: "x",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    },
  }))
  await mock.module("~/lib/tokenizer", () => ({
    getTokenCount: (_: unknown) => ({ input: 2, output: 3 }),
  }))

  const { server } = (await import("~/server")) as { server: TestServer }
  const res = await server.request("/v1beta/models/gemini-pro:countTokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
  })

  expect(res.status).toBe(200)
  const json = (await res.json()) as { totalTokens: number }
  expect(json).toEqual({ totalTokens: 5 })
  expect(downstreamCalled).toBe(false)
})

test("maps finish_reason stop/length/content_filter/tool_calls correctly (non-stream)", async () => {
  const finishCases = [
    { fr: "stop", expected: "STOP" },
    { fr: "length", expected: "MAX_TOKENS" },
    { fr: "content_filter", expected: "SAFETY" },
    { fr: "tool_calls", expected: "STOP" },
  ]

  let idx = 0
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      const fr = finishCases[idx++].fr as
        | "stop"
        | "length"
        | "content_filter"
        | "tool_calls"
      return {
        id: "x",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: fr,
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }
    },
  }))

  const { server } = (await import("~/server")) as { server: TestServer }
  for (const finishCase of finishCases) {
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
    const json = (await res.json()) as {
      candidates: [{ finishReason: string }]
    }
    const got = json.candidates[0].finishReason
    expect(got).toBe(finishCase.expected)
  }
})

test("optional manual approval gate triggers before downstream call", async () => {
  const calls: Array<string> = []
  await mock.module("~/lib/state", () => ({
    state: { manualApprove: true },
  }))
  await mock.module("~/lib/approval", () => ({
    awaitApproval: () => {
      calls.push("approve")
    },
  }))
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      calls.push("create")
      return {
        id: "x",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    },
  }))

  const { server } = (await import("~/server")) as { server: TestServer }
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
  expect(calls).toEqual(["approve", "create"])
})

test("enforces rate limit before processing (non-stream)", async () => {
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {
      throw new Error("Rate limited")
    },
  }))
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      return {
        id: "x",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    },
  }))

  const { server } = (await import("~/server")) as { server: TestServer }
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
  const json = (await res.json()) as {
    error: { message: string; type: string }
  }
  expect(json).toEqual({ error: { message: "Rate limited", type: "error" } })
})

test("enforces rate limit before stream", async () => {
  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: () => {
      throw new Error("Rate limited stream")
    },
  }))
  await createMockChatCompletions([
    {
      data: JSON.stringify({
        id: "c1",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      }),
    },
    {
      data: JSON.stringify({
        id: "c1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
    },
    { data: "[DONE]" },
  ])

  const { server } = (await import("~/server")) as { server: TestServer }
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
  const txt = await res.text()
  expect(txt.includes("Rate limited stream")).toBe(true)
})
