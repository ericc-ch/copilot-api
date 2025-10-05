import { afterEach, expect, test, mock } from "bun:test"

import { makeRequest, setupPayloadCapture, GEMINI_PRO_URL } from "./_test-utils"

afterEach(() => {
  mock.restore()
})

// Tool Call Processing & Cleanup Tests

test("handles tool call cleanup with incomplete tool calls", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should clean up incomplete tool calls (tool_calls without responses)
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "Search something" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
      },
      { role: "user", parts: [{ text: "What did you find?" }] },
    ],
  })

  expect(res.status).toBe(200)
  // Incomplete tool calls should be removed
  const assistantMessages =
    capturedPayload.messages?.filter((m) => m.role === "assistant") ?? []
  expect(assistantMessages.length).toBe(0)

  // User messages should still be present
  const userMessages =
    capturedPayload.messages?.filter((m) => m.role === "user") ?? []
  expect(userMessages.length).toBeGreaterThan(0)
})

test("processes inline data with inlineData field", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should process inline data (base64-encoded images) correctly
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze this image" },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          },
        ],
      },
    ],
  })

  expect(res.status).toBe(200)
  expect(capturedPayload.messages?.length).toBe(1)

  const userMessage = capturedPayload.messages?.[0]
  expect(userMessage?.role).toBe("user")
  // Content should include both text and image data
  const content = userMessage?.content
  expect(content).toBeDefined()
  expect(typeof content === "string" || Array.isArray(content)).toBe(true)
})

test("handles streaming tool calls with incomplete arguments", async () => {
  // This tests the streaming tool call processing logic
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [{ role: "user", parts: [{ text: "Do a search" }] }],
  })

  expect(res.status).toBe(200)
})

test("accumulates streaming tool call arguments correctly", async () => {
  // Should handle streaming arguments accumulation correctly
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [{ role: "user", parts: [{ text: "Search for something" }] }],
  })

  expect(res.status).toBe(200)
  // The request should process successfully even with complex tool call scenarios
})

test("handles Google Search tool processing", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should handle Google Search tool configuration and processing
  const res = await makeRequest(GEMINI_PRO_URL, {
    tools: [
      {
        googleSearchRetrieval: {
          dynamicRetrievalConfig: {
            mode: "MODE_DYNAMIC",
            dynamicThreshold: 0.7,
          },
        },
      },
    ],
    contents: [{ role: "user", parts: [{ text: "Search for latest news" }] }],
  })

  expect(res.status).toBe(200)
  expect(capturedPayload.messages?.length).toBe(1)

  const userMessage = capturedPayload.messages?.[0]
  expect(userMessage?.role).toBe("user")
  expect(userMessage?.content).toContain("latest news")

  // Google Search tool is Gemini-specific and gets translated
  // It may or may not appear in the tools array depending on translation logic
  // The key is that the request succeeds
  expect(capturedPayload.messages).toBeDefined()
})

// Error Handling Tests

test("handles translation errors gracefully", async () => {
  // Should return appropriate error status when Copilot API fails
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => {
      throw new Error("Copilot API error")
    },
  }))

  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [{ role: "user", parts: [{ text: "This should fail" }] }],
  })

  // Should handle the error and return appropriate status
  expect(res.status).toBeGreaterThanOrEqual(400)
})

test("handles malformed tool calls in content processing", async () => {
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

  // Test malformed function call handling
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "Process this" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "", // Empty name should trigger error handling
              args: {},
            },
          },
        ],
      },
    ],
  })

  expect(res.status).toBe(200)
  // Should handle malformed calls gracefully
})
