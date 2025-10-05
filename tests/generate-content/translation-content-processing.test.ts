import { afterEach, expect, test, mock } from "bun:test"

import { makeRequest, setupPayloadCapture, GEMINI_PRO_URL } from "./_test-utils"

afterEach(() => {
  mock.restore()
})

// Content Processing & Message Merging Tests

test("processes function response arrays with tool call matching", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should correctly process nested function response arrays
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "Call function" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "testFunc", args: { param: "value" } },
          },
        ],
      },
      {
        role: "user",
        parts: [
          [
            {
              functionResponse: {
                name: "testFunc",
                response: { result: "success" },
              },
            },
          ],
        ],
      },
    ],
  })

  expect(res.status).toBe(200)

  // Behavior assertion: verify response structure and content
  const resBody = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  expect(resBody).toHaveProperty("candidates")
  expect(resBody.candidates).toBeInstanceOf(Array)
  expect(resBody.candidates?.[0]?.content?.parts).toBeDefined()

  // Verify nested array structure is processed correctly
  const messages = capturedPayload.messages ?? []
  expect(messages.length).toBeGreaterThan(0)
})

test("handles function response without matching tool call", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should skip function responses without matching tool calls
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "Call function" }] },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "nonExistentFunc",
              response: { result: "orphaned" },
            },
          },
        ],
      },
    ],
  })

  expect(res.status).toBe(200)

  // Behavior assertion: verify response contains valid content despite orphaned function response
  const resBody = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  expect(resBody.candidates?.[0]?.content?.parts).toBeDefined()
  expect(resBody.candidates?.[0]?.content?.parts?.[0]?.text).toBeDefined()

  const toolMessages =
    capturedPayload.messages?.filter((m) => m.role === "tool") ?? []
  expect(toolMessages.length).toBe(0)
})

test("handles empty content merging fallback", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should merge empty and whitespace-only content correctly
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "" }] }, // Empty text
      { role: "user", parts: [{ text: "  " }] }, // Whitespace only
      { role: "user", parts: [{ text: "actual question" }] },
    ],
  })

  expect(res.status).toBe(200)
  const userMessages =
    capturedPayload.messages?.filter((m) => m.role === "user") ?? []
  expect(userMessages.length).toBe(1)
  expect(userMessages[0]?.content).toContain("actual question")
  // Ensure empty/whitespace content doesn't appear in merged message
  expect(userMessages[0]?.content).not.toMatch(/^\s*$/)
})

test("handles complex content that cannot be merged", async () => {
  const capturedPayload = await setupPayloadCapture()

  // Should handle complex content mixing text and function responses
  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: [
      { role: "user", parts: [{ text: "First message" }] },
      {
        role: "user",
        parts: [
          { text: "Second message" },
          {
            functionResponse: {
              name: "func",
              response: { data: "complex" },
            },
          },
        ],
      },
    ],
  })

  expect(res.status).toBe(200)
  const messages = capturedPayload.messages ?? []
  expect(messages.length).toBeGreaterThan(0)

  // Verify text messages are merged but function responses are handled separately
  const userMessages = messages.filter((m) => m.role === "user")
  expect(userMessages.length).toBeGreaterThan(0)
  const mergedContent = userMessages.map((m) => m.content).join(" ")
  expect(mergedContent).toContain("First message")
  expect(mergedContent).toContain("Second message")
})

// Model Mapping Tests

test.each([
  ["gemini-2.5-flash", "gemini-2.0-flash-001"],
  ["gemini-1.5-pro", "gemini-1.5-pro"],
])("maps model %s to %s correctly", async (inputModel, expectedModel) => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(
    `/v1beta/models/${inputModel}:generateContent`,
    {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    },
  )

  expect(res.status).toBe(200)
  expect(capturedPayload.model).toBe(expectedModel)
})
