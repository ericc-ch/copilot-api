import { afterEach, expect, test, mock } from "bun:test"

import { asyncIterableFrom, expectSSEContains } from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test("[Stream] handles complete tool call parameters in single chunk", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () =>
      asyncIterableFrom([
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
                      function: {
                        name: "ReadFile",
                        arguments: '{"absolute_path": "/path/to/file.txt"}',
                      },
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
      ]),
  }))

  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: (_: unknown) => {},
  }))
  const { server } = await import("~/server?stream-complete-params")
  const res = await server.request(
    "/v1beta/models/gemini-pro:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Read the file" }] }],
      }),
    },
  )

  expect(res.status).toBe(200)
  const body = await res.text()
  expectSSEContains(body, {
    toolCall: {
      name: "ReadFile",
      completeArgs: true,
    },
    jsonContains: '"absolute_path":"/path/to/file.txt"',
  })
})

test("[Stream] handles fragmented tool call parameters across multiple chunks", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () =>
      asyncIterableFrom([
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
                      function: { name: "ReadFile", arguments: '{"absolu' },
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
                      function: { arguments: 'te_path": "/file.txt"}' },
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
      ]),
  }))

  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: (_: unknown) => {},
  }))
  const { server } = await import("~/server?stream-fragmented-params")
  const res = await server.request(
    "/v1beta/models/gemini-pro:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Read the file" }] }],
      }),
    },
  )

  expect(res.status).toBe(200)
  const body = await res.text()
  expectSSEContains(body, {
    toolCall: {
      name: "ReadFile",
      completeArgs: true,
    },
    jsonContains: '"absolute_path":"/file.txt"',
  })
})

test("[Stream] correctly processes multiple concurrent tool calls", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () =>
      asyncIterableFrom([
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
                      function: {
                        name: "ReadFile",
                        arguments: '{"path": "/read.txt"}',
                      },
                    },
                    {
                      index: 1,
                      type: "function",
                      function: {
                        name: "WriteFile",
                        arguments: '{"path": "/write.txt", "content": "data"}',
                      },
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
      ]),
  }))

  await mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: (_: unknown) => {},
  }))
  const { server } = await import("~/server?stream-multiple-tools")
  const res = await server.request(
    "/v1beta/models/gemini-pro:streamGenerateContent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Read and write files" }] }],
      }),
    },
  )

  expect(res.status).toBe(200)
  const body = await res.text()
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
