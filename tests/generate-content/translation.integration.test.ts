import { afterEach, describe, expect, test, mock } from "bun:test"

import type { TranslationCase } from "./test-types"

import {
  makeRequest,
  setupPayloadCapture,
  expectMessageCounts,
  expectUniqueToolCallIds,
  expectToolCallIdFormat,
  expectToolCleanup,
  GEMINI_PRO_URL,
  buildTranslationCase,
} from "./_test-utils/integration"

afterEach(() => {
  mock.restore()
})

// ========================================
// Translation Integration Tests
// Consolidates: translation*.test.ts files
// ========================================

// eslint-disable-next-line max-lines-per-function
describe("Translation Integration", () => {
  // ========================================
  // Role Normalization Matrix
  // ========================================
  describe("Role Normalization", () => {
    const roleCases: Array<TranslationCase> = [
      buildTranslationCase({
        name: "merges same-role consecutive messages",
        contents: [
          { role: "user", parts: [{ text: "Hello." }] },
          { role: "user", parts: [{ text: "How are you?" }] },
        ],
        expectMessages: 1,
        expectRoles: ["user"],
      }),
      buildTranslationCase({
        name: "handles system instruction in contents",
        systemInstruction: { parts: [{ text: "You are a helpful assistant" }] },
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        expectMessages: 2,
        expectRoles: ["system", "user"],
      }),
    ]

    test.each(roleCases)(
      "$name",
      async (testCase) => {
        const capturedPayload = await setupPayloadCapture()

        const res = await makeRequest(GEMINI_PRO_URL, {
          systemInstruction: testCase.input.systemInstruction,
          contents: testCase.input.contents,
        })

        expect(res.status).toBe(200)

        if (testCase.expect.messageCount) {
          expect(capturedPayload.messages?.length).toBeGreaterThanOrEqual(
            testCase.expect.messageCount,
          )
        }

        if (testCase.expect.roles) {
          const actualRoles = (capturedPayload.messages ?? []).map(
            (m) => m.role,
          )
          for (const expectedRole of testCase.expect.roles) {
            expect(actualRoles).toContain(expectedRole)
          }
        }
      },
      10000,
    ) // 10 second timeout
  })

  // ========================================
  // Tool Call Lifecycle Matrix
  // ========================================
  describe("Tool Call Lifecycle", () => {
    test("handles incomplete tool calls cleanup", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Search for cats." }] },
          {
            role: "model",
            parts: [
              { functionCall: { name: "search", args: { query: "cats" } } },
            ],
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

    test("handles complex tool call workflow", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Read a file" }] },
          {
            role: "model",
            parts: [
              {
                functionCall: { name: "readFile", args: { path: "test.txt" } },
              },
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
      expect(capturedPayload.messages?.some((m) => m.role === "tool")).toBe(
        true,
      )
    })

    test("synthesizes tools from function calls when tools not provided", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Do a web search" }] },
          {
            role: "model",
            parts: [
              { functionCall: { name: "search", args: { query: "cats" } } },
            ],
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
  })

  // ========================================
  // Content Processing
  // ========================================
  describe("Content Processing", () => {
    test("processes inline data with inlineData field", async () => {
      const capturedPayload = await setupPayloadCapture()

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
      const content = userMessage?.content
      expect(content).toBeDefined()
      expect(typeof content === "string" || Array.isArray(content)).toBe(true)
    })

    test("processes function response arrays with tool call matching", async () => {
      const capturedPayload = await setupPayloadCapture()

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
      expect(capturedPayload).toHaveProperty("messages")
      expect(capturedPayload.messages).toBeInstanceOf(Array)
    })

    test("handles function response without matching tool call", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Call function" }] },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "testFunc",
                  response: { result: "orphan" },
                },
              },
            ],
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(capturedPayload.messages?.length).toBeGreaterThan(0)
    })

    test("handles Google Search tool processing", async () => {
      const capturedPayload = await setupPayloadCapture()

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
        contents: [
          { role: "user", parts: [{ text: "Search for latest news" }] },
        ],
      })

      expect(res.status).toBe(200)
      expect(capturedPayload.messages?.length).toBe(1)

      const userMessage = capturedPayload.messages?.[0]
      expect(userMessage?.role).toBe("user")
      expect(userMessage?.content).toContain("latest news")
    })
  })

  // ========================================
  // Multi-turn Scenarios (from multiTurnTestCases)
  // ========================================
  describe("Multi-turn Scenarios", () => {
    test("handles multi-turn tool call conversation correctly", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Read file A" }] },
          {
            role: "model",
            parts: [
              { functionCall: { name: "readFile", args: { path: "a.txt" } } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "readFile",
                  response: { content: "Content of A" },
                },
              },
            ],
          },
          {
            role: "model",
            parts: [{ text: "File A contains: Content of A" }],
          },
          { role: "user", parts: [{ text: "Now read file B" }] },
          {
            role: "model",
            parts: [
              { functionCall: { name: "readFile", args: { path: "b.txt" } } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "readFile",
                  response: { content: "Content of B" },
                },
              },
            ],
          },
        ],
      })

      expect(res.status).toBe(200)
      expectMessageCounts(capturedPayload, {
        total: 5,
        assistantWithTools: 2,
        tool: 2,
      })
      expectToolCallIdFormat(capturedPayload)
    })

    test("handles duplicate tool responses by deduplication", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Call function" }] },
          {
            role: "model",
            parts: [
              { functionCall: { name: "testFunc", args: { param: "value1" } } },
              {
                functionCall: { name: "testFunc2", args: { param: "value2" } },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "testFunc",
                  response: { result: "first" },
                },
              },
              {
                functionResponse: {
                  name: "testFunc2",
                  response: { result: "second" },
                },
              },
              // Duplicate response - should be deduplicated
              {
                functionResponse: {
                  name: "testFunc",
                  response: { result: "duplicate" },
                },
              },
            ],
          },
        ],
      })

      expect(res.status).toBe(200)
      expectUniqueToolCallIds(capturedPayload, 2)
    })

    test("verifies tool_call_id length constraint (≤40 characters)", async () => {
      const capturedPayload = await setupPayloadCapture()

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [
          { role: "user", parts: [{ text: "Call a function" }] },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "veryLongFunctionNameThatMightCauseIssues",
                  args: { param: "test" },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "veryLongFunctionNameThatMightCauseIssues",
                  response: { result: "ok" },
                },
              },
            ],
          },
        ],
      })

      expect(res.status).toBe(200)
      expectToolCallIdFormat(capturedPayload)
    })
  })

  // ========================================
  // Response Coverage (OpenAI → Gemini)
  // ========================================
  describe("Response Coverage", () => {
    type ResponseCoverageCase = {
      name: string
      message: {
        role: "assistant"
        content?: string | null
        tool_calls?: Array<{
          id: string
          type: "function"
          function: { name: string; arguments: string }
        }>
      }
      finish_reason: "stop" | "tool_calls"
      expectedParts: Array<
        | { text: string }
        | { functionCall: { name: string; args: Record<string, unknown> } }
      >
    }

    const responseCases: Array<ResponseCoverageCase> = [
      {
        name: "handles assistant message with tool calls having arguments",
        message: {
          role: "assistant",
          content: "I'll search for that",
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              function: {
                name: "search",
                arguments: '{"query": "test query", "limit": 10}',
              },
            },
          ],
        },
        finish_reason: "tool_calls",
        expectedParts: [
          { text: "I'll search for that" },
          {
            functionCall: {
              name: "search",
              args: { query: "test query", limit: 10 },
            },
          },
        ],
      },
      {
        name: "handles assistant message with tool calls having empty arguments",
        message: {
          role: "assistant",
          content: "Getting current time",
          tool_calls: [
            {
              id: "call_456",
              type: "function" as const,
              function: { name: "get_current_time", arguments: "" },
            },
          ],
        },
        finish_reason: "tool_calls",
        expectedParts: [
          { text: "Getting current time" },
          { functionCall: { name: "get_current_time", args: {} } },
        ],
      },
      {
        name: "handles assistant message with simple text content",
        message: { role: "assistant", content: "Here's my response" },
        finish_reason: "stop",
        expectedParts: [{ text: "Here's my response" }],
      },
    ]

    test.each(responseCases)("$name", async (testCase) => {
      const { translateOpenAIToGemini } = await import(
        "~/routes/generate-content/translation"
      )

      const openAIResponse = {
        id: "chatcmpl-test",
        object: "chat.completion" as const,
        created: Date.now(),
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              ...testCase.message,
              content: testCase.message.content ?? null,
            },
            finish_reason: testCase.finish_reason,
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }

      const result = translateOpenAIToGemini(openAIResponse)

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.content.parts).toHaveLength(
        testCase.expectedParts.length,
      )

      for (let i = 0; i < testCase.expectedParts.length; i++) {
        expect(result.candidates[0]?.content.parts[i]).toEqual(
          testCase.expectedParts[i],
        )
      }
    })
  })

  // ========================================
  // Error Handling
  // ========================================
  describe("Error Handling", () => {
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

    test("handles translation errors gracefully", async () => {
      await mock.module("~/services/copilot/create-chat-completions", () => ({
        createChatCompletions: () => {
          throw new Error("Copilot API error")
        },
      }))

      const res = await makeRequest(GEMINI_PRO_URL, {
        contents: [{ role: "user", parts: [{ text: "This should fail" }] }],
      })

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
    })
  })
})
