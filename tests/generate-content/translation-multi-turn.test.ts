import { afterEach, expect, test, mock } from "bun:test"

import {
  makeRequest,
  setupPayloadCapture,
  expectMessageCounts,
  expectUniqueToolCallIds,
  expectToolCallIdFormat,
  GEMINI_PRO_URL,
} from "./_test-utils"

afterEach(() => {
  mock.restore()
})

// Multi-turn & Advanced Tool Call Scenarios

const multiTurnTestCases = [
  {
    name: "handles multi-turn tool call conversation correctly",
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
    expectedCounts: {
      total: 5,
      assistantWithTools: 2,
      tool: 2,
    },
    verifyFormat: true,
  },
  {
    name: "handles duplicate tool responses by deduplication",
    contents: [
      { role: "user", parts: [{ text: "Call function" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "testFunc", args: { param: "value1" } } },
          { functionCall: { name: "testFunc2", args: { param: "value2" } } },
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
    uniqueToolCallIds: 2,
  },
  {
    name: "verifies tool_call_id length constraint (≤40 characters)",
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
    verifyFormat: true,
  },
]

test.each(multiTurnTestCases)("$name", async (testCase) => {
  const capturedPayload = await setupPayloadCapture()

  const res = await makeRequest(GEMINI_PRO_URL, {
    contents: testCase.contents,
  })

  expect(res.status).toBe(200)

  if (testCase.expectedCounts) {
    expectMessageCounts(capturedPayload, testCase.expectedCounts)
  }

  if (testCase.uniqueToolCallIds) {
    expectUniqueToolCallIds(capturedPayload, testCase.uniqueToolCallIds)
  }

  if (testCase.verifyFormat) {
    expectToolCallIdFormat(capturedPayload)
  }
})
