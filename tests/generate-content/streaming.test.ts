import { afterEach, expect, test, mock } from "bun:test"

import type { TestServer } from "./test-types"

import {
  asyncIterableFrom,
  createMockChatCompletions,
  createMockRateLimit,
} from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test("falls back to streaming when downstream returns non-stream JSON", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) => ({
      id: "res-3",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "stream me" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }),
  }))

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

  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") || ""
  expect(ct.includes("text/event-stream")).toBe(true)
  const body = await res.text()

  expect(body.includes("data:")).toBe(true)
  expect(body.includes("stream me")).toBe(true)
  expect(body.includes('"finishReason":"STOP"')).toBe(true)
  expect(body.includes('"usageMetadata"')).toBe(true)

  const occurrences = (body.match(/stream me/g) || []).length
  expect(occurrences >= 1).toBe(true)
})

test("accumulates and parses partial JSON chunks", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (_: unknown) => {
      const firstChunk = {
        id: "c1",
        choices: [
          { index: 0, delta: { content: "hello" }, finish_reason: null },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
      const json = JSON.stringify(firstChunk)
      const mid = Math.floor(json.length / 2)
      const finishChunk = {
        id: "c1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
      return asyncIterableFrom([
        { data: json.slice(0, mid) },
        { data: json.slice(mid) },
        { data: JSON.stringify(finishChunk) },
        { data: "[DONE]" },
      ])
    },
  }))

  await createMockRateLimit()
  const { server } = (await import(
    "~/server?streaming-parser-accumulation"
  )) as { server: TestServer }
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

  const helloCount = (body.match(/hello/g) || []).length
  expect(helloCount).toBe(1)

  expect(body.includes('"finishReason":"STOP"')).toBe(true)
  expect(body.includes("data:")).toBe(true)
})

test("includes usageMetadata only on final chunk and injects empty part when only finish_reason", async () => {
  await createMockChatCompletions([
    {
      data: JSON.stringify({
        id: "c1",
        choices: [
          { index: 0, delta: { content: "hello" }, finish_reason: null },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    },
    {
      data: JSON.stringify({
        id: "c1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    },
    { data: "[DONE]" },
  ])

  await createMockRateLimit()
  const { server } = (await import(
    "~/server?stream-finish-reason-and-empty-part"
  )) as { server: TestServer }
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
  const body = await res.text()

  const usageCount = (body.match(/"usageMetadata"/g) || []).length
  expect(usageCount).toBe(1)

  const finishStop = body.includes('"finishReason":"STOP"')
  expect(finishStop).toBe(true)

  const injectedEmpty = body.includes('"parts":[{"text":""}]')
  expect(injectedEmpty).toBe(true)
})

test("[Stream] skips tool_calls with partial JSON arguments until complete", async () => {
  await createMockChatCompletions([
    {
      data: JSON.stringify({
        id: "c1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: "function",
                  function: { name: "f", arguments: '{"a":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    },
    {
      data: JSON.stringify({
        id: "c1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: "function",
                  function: { name: "f", arguments: '{"a":1}' },
                },
              ],
            },
            finish_reason: null,
          },
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
  ])

  await createMockRateLimit()
  const { server } = (await import(
    "~/server?stream-skip-partial-tool-calls"
  )) as {
    server: TestServer
  }
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
  const body = await res.text()

  expect(body.includes('"functionCall":{"name":"f","args"')).toBe(true)
  expect(body.includes('"functionCall":{"name":"f","args":{')).toBe(true)
  expect(body.includes('"functionCall":{"name":"f","args":{')).toBe(true)
  expect(body.includes('"functionCall":{"name":"f","args":{"a":1}')).toBe(true)
})
