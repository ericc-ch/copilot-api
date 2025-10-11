import { afterEach, expect, test, mock } from "bun:test"

import type { TestServer } from "./test-types"

import {
  asyncIterableFrom,
  createMockChatCompletions,
  createMockRateLimit,
  expectOKEventStream,
  expectSSEContains,
  mockDownstreamJSONResponse,
  mockDownstreamStreamChunks,
  readSSE,
  requestStream,
  streamChunks,
} from "./_test-utils/streaming"

afterEach(() => {
  mock.restore()
})

test("falls back to streaming when downstream returns non-stream JSON", async () => {
  await mockDownstreamJSONResponse({
    id: "res-3",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "stream me" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  })

  const { res } = await requestStream()
  expectOKEventStream(res)

  const body = await readSSE(res)
  expectSSEContains(body, {
    text: "stream me",
    finishReason: "STOP",
    usageMetadata: true,
    textMatch: { pattern: "stream me", minOccurrences: 1 },
  })
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

  void createMockRateLimit()
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
  expect(res.headers.get("content-type")).toContain("text/event-stream")

  const body = await res.text()
  expectSSEContains(body, {
    finishReason: "STOP",
    textMatch: { pattern: "hello", minOccurrences: 1 },
  })
})

test("includes usageMetadata only on final chunk and injects empty part when only finish_reason", async () => {
  void createMockChatCompletions([
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

  void createMockRateLimit()
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
  const body = await res.text()

  expectSSEContains(body, {
    finishReason: "STOP",
    textMatch: { pattern: /"usageMetadata"/g, minOccurrences: 1 },
    jsonContains: '"parts":[{"text":""}]',
  })
})

test("[Stream] skips tool_calls with partial JSON arguments until complete", async () => {
  void createMockChatCompletions([
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

  void createMockRateLimit()
  const { server } = (await import("~/server")) as {
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

  // Verify streaming tool call accumulation: name → args opening → args completion
  expectSSEContains(body, {
    toolCall: {
      name: "f",
      hasArgs: true,
      completeArgs: true,
    },
  })
})

test("[Stream] handles complete tool call parameters in single chunk", async () => {
  mockDownstreamStreamChunks([
    streamChunks.toolArgs("c1", {
      name: "ReadFile",
      arguments: '{"absolute_path": "/path/to/file.txt"}',
    }),
    streamChunks.finish("c1"),
    streamChunks.done(),
  ])

  const { res } = await requestStream()
  expectOKEventStream(res)

  const body = await readSSE(res)
  expectSSEContains(body, {
    toolCall: {
      name: "ReadFile",
      completeArgs: true,
    },
    jsonContains: '"absolute_path":"/path/to/file.txt"',
  })
})

test("[Stream] handles fragmented tool call parameters across multiple chunks", async () => {
  mockDownstreamStreamChunks([
    streamChunks.toolArgs("c1", {
      name: "ReadFile",
      arguments: '{"absolu',
    }),
    streamChunks.toolArgs("c1", {
      arguments: 'te_path": "/file.txt"}',
    }),
    streamChunks.finish("c1"),
    streamChunks.done(),
  ])

  const { res } = await requestStream()
  expectOKEventStream(res)

  const body = await readSSE(res)
  expectSSEContains(body, {
    toolCall: {
      name: "ReadFile",
      completeArgs: true,
    },
    jsonContains: '"absolute_path":"/file.txt"',
  })
})

test("[Stream] correctly processes multiple concurrent tool calls", async () => {
  mockDownstreamStreamChunks([
    streamChunks.toolArgs("c1", {
      name: "ReadFile",
      arguments: '{"path": "/read.txt"}',
      index: 0,
    }),
    streamChunks.toolArgs("c1", {
      name: "WriteFile",
      arguments: '{"path": "/write.txt", "content": "data"}',
      index: 1,
    }),
    streamChunks.finish("c1"),
    streamChunks.done(),
  ])

  const { res } = await requestStream()
  expectOKEventStream(res)

  const body = await readSSE(res)
  expectSSEContains(body, {
    toolCall: {
      name: "ReadFile",
      completeArgs: true,
    },
    jsonContains: '"path":"/read.txt"',
  })
  expectSSEContains(body, {
    toolCall: {
      name: "WriteFile",
      completeArgs: true,
    },
    jsonContains: '"path":"/write.txt"',
  })
})
