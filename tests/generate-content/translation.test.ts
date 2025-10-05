import { afterEach, expect, test, mock } from "bun:test"

import {
  makeRequest,
  setupPayloadCapture,
  expectToolCleanup,
  GEMINI_PRO_URL,
} from "./_test-utils"

afterEach(() => {
  mock.restore()
})

test.each([
  ["AUTO", "auto"],
  ["ANY", "required"],
  ["NONE", "none"],
])(
  "processes toolConfig %s mapping to %s end-to-end",
  async (inputMode, expectedChoice) => {
    const capturedPayload = await setupPayloadCapture()

    const res = await makeRequest(GEMINI_PRO_URL, {
      tools: [
        {
          functionDeclarations: [
            { name: "test", parameters: { type: "object" } },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: inputMode } },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    })

    expect(res.status).toBe(200)
    expect(capturedPayload.tool_choice).toBe(expectedChoice)
  },
)

test("handles urlContext tool filtering in request", async () => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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

  // Verify urlContext is filtered out, readFile is retained
  const toolNames = new Set(
    capturedPayload.tools?.map((t) => t.function.name) ?? [],
  )
  expect(toolNames.has("readFile")).toBe(true)
  expect(toolNames.has("urlContext")).toBe(false)

  // Verify no empty function names remain after filtering
  expectToolCleanup(capturedPayload, { noEmptyFunctions: true })
})

test("synthesizes tools from function calls when tools not provided", async () => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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

  // Verify synthesized tools have no duplicates and no empty names
  expectToolCleanup(capturedPayload, {
    noDuplicates: true,
    noEmptyFunctions: true,
  })
})

test("handles same-role message merging behavior", async () => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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

  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [],
  })

  // Empty contents cause translation error, expect 500 status
  expect(res.status).toBe(500)
})

test("handles complex tool call workflow", async () => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
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
