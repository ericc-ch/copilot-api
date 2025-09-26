import { afterEach, expect, test, mock } from "bun:test"

import type { CapturedPayload } from "./test-types"

import { makeRequest } from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test("processes toolConfig AUTO/ANY/NONE mapping end-to-end", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  // toolConfig 需要有 tools 才会被处理，所以添加 tools
  const baseRequest = {
    tools: [
      {
        functionDeclarations: [
          { name: "test", parameters: { type: "object" } },
        ],
      },
    ],
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
  }

  // Test AUTO -> auto
  const autoRes = await makeRequest(
    "/v1beta/models/gemini-pro:generateContent",
    {
      ...baseRequest,
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    },
  )
  expect(autoRes.status).toBe(200)
  expect(capturedPayload.tool_choice).toBe("auto")

  // Test ANY -> required
  const anyRes = await makeRequest(
    "/v1beta/models/gemini-pro:generateContent",
    {
      ...baseRequest,
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    },
  )
  expect(anyRes.status).toBe(200)
  expect(capturedPayload.tool_choice).toBe("required")

  // Test NONE -> none
  const noneRes = await makeRequest(
    "/v1beta/models/gemini-pro:generateContent",
    {
      ...baseRequest,
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    },
  )
  expect(noneRes.status).toBe(200)
  expect(capturedPayload.tool_choice).toBe("none")
})

test("handles urlContext tool filtering in request", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    tools: [
      { urlContext: {} },
      {
        functionDeclarations: [
          { name: "readFile", parameters: { type: "object" } },
        ],
      },
    ],
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
  })

  expect(res.status).toBe(200)
  expect(capturedPayload.tools).toBeDefined()
  const toolNames = new Set(
    capturedPayload.tools?.map((t) => t.function.name) ?? [],
  )
  expect(toolNames.has("readFile")).toBe(true)
  expect(toolNames.has("urlContext")).toBe(false)
})

test("synthesizes tools from function calls when tools not provided", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [
      { role: "user", parts: [{ text: "Do a web search" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "search", args: { query: "cats" } } }],
      },
    ],
  })

  expect(res.status).toBe(200)
  expect(capturedPayload.tools).toBeDefined()
  const toolNames = capturedPayload.tools?.map((t) => t.function.name) ?? []
  expect(toolNames.includes("search")).toBe(true)
})

test("handles same-role message merging behavior", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [
      { role: "user", parts: [{ text: "Hello." }] },
      { role: "user", parts: [{ text: "How are you?" }] },
    ],
  })

  expect(res.status).toBe(200)
  const userMessages =
    capturedPayload.messages?.filter((m) => m.role === "user") ?? []
  expect(userMessages.length).toBe(1)
  expect(userMessages[0]?.content).toContain("Hello.")
  expect(userMessages[0]?.content).toContain("How are you?")
})

test("handles incomplete tool calls cleanup", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [
      { role: "user", parts: [{ text: "Search for cats." }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "search", args: { query: "cats" } } }],
      },
      { role: "user", parts: [{ text: "Show me results." }] },
    ],
  })

  expect(res.status).toBe(200)
  const assistantMessages =
    capturedPayload.messages?.filter((m) => m.role === "assistant") ?? []
  expect(assistantMessages.length).toBe(0)
  const userMessages =
    capturedPayload.messages?.filter((m) => m.role === "user") ?? []
  expect(userMessages.length).toBeGreaterThan(0)
})

test("handles system instruction in contents", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    systemInstruction: { parts: [{ text: "You are a helpful assistant" }] },
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
  })

  expect(res.status).toBe(200)
  const systemMessage = capturedPayload.messages?.find(
    (m) => m.role === "system",
  )
  expect(systemMessage).toBeDefined()
  expect(systemMessage?.content).toContain("helpful assistant")
})

test("handles empty contents gracefully", async () => {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      throw new Error("Should not be called with empty contents")
    },
  }))

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [],
  })

  // 空 contents 会导致翻译过程中出错，返回 500
  expect(res.status).toBe(500)
})

test("handles complex tool call workflow", async () => {
  let capturedPayload: CapturedPayload = {} as CapturedPayload
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      capturedPayload = payload
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

  const res = await makeRequest("/v1beta/models/gemini-pro:generateContent", {
    contents: [
      { role: "user", parts: [{ text: "Read a file" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "readFile", args: { path: "test.txt" } } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "readFile",
              response: { content: "Hello World" },
            },
          },
        ],
      },
    ],
  })

  expect(res.status).toBe(200)
  expect(
    capturedPayload.messages?.some(
      (m) => m.role === "assistant" && m.tool_calls,
    ),
  ).toBe(true)
  expect(capturedPayload.messages?.some((m) => m.role === "tool")).toBe(true)
})
