/* eslint-disable max-lines-per-function, max-nested-callbacks */
import type { Context } from "hono"

// Standard library imports first
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test"

import type {
  ChatCompletionsPayload,
  Message,
} from "~/services/copilot/create-chat-completions"

// Internal imports, organized by path/module
import { HTTPError } from "~/lib/http-error"
import { createChatCompletions } from "~/services/copilot/create-chat-completions"

import { handleCompletion } from "./handler"

// Define proper types for mocking
// Use a more specific type definition instead of Function
type MockFunction<T = (...args: Array<unknown>) => unknown> = T & {
  mock: {
    calls: Array<Array<unknown>>
  }
}

// Define alias for the unused type just to satisfy the linter
type _MockFunction = MockFunction

// Define mock context type
interface MockContext {
  req: {
    json: <T>() => Promise<T>
  }
  json: (data: unknown, status?: number) => unknown
}

// Create a mock json function
const jsonMock = mock((data: unknown, _status?: number) => data)

// Create a mock Hono context for testing
function createMockContext(body: ChatCompletionsPayload): MockContext {
  return {
    req: {
      json: <T>() => Promise.resolve(body as unknown as T),
    },
    json: jsonMock,
  }
}

// Helper function to run the handler
const runHandler = async (context: MockContext): Promise<unknown> => {
  return handleCompletion(context as unknown as Context)
}

// Create the mocks
const createChatCompletionsMock = mock<typeof createChatCompletions>()
const awaitApprovalMock = mock(() => Promise.resolve())
const checkRateLimitMock = mock(() => Promise.resolve())
const getTokenCountMock = mock(() => ({ input: 10, output: 0 }))

// Set up mocks before tests run
beforeAll(async () => {
  await Promise.all([
    mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: createChatCompletionsMock,
    })),
    mock.module("~/lib/approval", () => ({
      awaitApproval: awaitApprovalMock,
    })),
    mock.module("~/lib/rate-limit", () => ({
      checkRateLimit: checkRateLimitMock,
    })),
    mock.module("~/lib/tokenizer", () => ({
      getTokenCount: getTokenCountMock,
    })),
    mock.module("~/lib/state", () => ({
      state: {
        manualApprove: false,
      },
    })),
  ])
})

/**
 * Reset and configure mocks with default behavior
 */
function setupMocks() {
  // Reset all mocks
  mock.restore()

  // Set up default mock response with proper types
  createChatCompletionsMock.mockResolvedValue({
    choices: [
      {
        index: 0,
        message: {
          content: "Test response",
          role: "assistant",
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    id: "test-id",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-4",
  })
}

// Main test suite
// Top-level test categories
describe("Handler Tests", () => {
  // Set up before each test
  beforeEach(() => {
    setupMocks()
  })

  // Clean up after each test
  afterEach(() => {
    mock.restore()
  })

  // Group tests by functionality
  describe("Message Sanitization", () => {
    /**
     * Test message content flattening functionality
     */
    describe("Content Flattening", () => {
      // Test data for array content
      const arrayContent = [
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ] as unknown as string

      let testContext: MockContext

      beforeEach(() => {
        // Create context with array content
        testContext = createMockContext({
          messages: [{ role: "user", content: arrayContent }],
          model: "gpt-4",
        })
      })

      it("should flatten array content to a single string", async () => {
        // Process message
        await runHandler(testContext)

        // Verify content is flattened properly
        expect(createChatCompletionsMock).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: [{ role: "user", content: "hello world" }],
          }),
        )
      })
    })

    /**
     * Test tag cleaning functionality in messages
     */
    describe("Tag Handling", () => {
      /**
       * Test fixtures for tag handling tests
       */
      const tagTestCases = {
        envDetails: {
          input:
            "start <environment_details>debug info</environment_details> end",
          expected: "start  end",
          description: "environment_details blocks entirely",
        },
        taskTags: {
          input: "<task>actual instruction</task>",
          expected: "actual instruction",
          description: "task tags while preserving content",
        },
      }

      /**
       * Shared test function to reduce duplication
       */
      function runTagTest(testCase: keyof typeof tagTestCases) {
        // Create test context with a fixture
        const fixture = tagTestCases[testCase]
        const testMessage: Message = {
          role: "user",
          content: fixture.input,
        }

        it(`should remove ${fixture.description}`, async () => {
          // Setup context with test message
          const context = createMockContext({
            messages: [testMessage],
            model: "gpt-4",
          })

          // Process the message
          await runHandler(context)

          // Verify tags were handled correctly
          expect(createChatCompletionsMock).toHaveBeenCalledWith(
            expect.objectContaining({
              messages: [
                {
                  role: "user",
                  content: fixture.expected,
                },
              ],
            }),
          )
        })
      }

      // Run the tests using the test function
      runTagTest("envDetails")
      runTagTest("taskTags")
    })

    /**
     * Test empty message filtering functionality
     */
    describe("Empty Message Handling", () => {
      /**
       * Test fixtures for empty message tests
       */
      const emptyMessageTestCases = {
        whitespace: {
          input: [
            { role: "system" as const, content: "You are a helpful assistant" },
            { role: "user" as const, content: "   " }, // Should be filtered out
            { role: "user" as const, content: "valid message" },
          ] as Array<Message>,
          expected: [
            { role: "system" as const, content: "You are a helpful assistant" },
            { role: "user" as const, content: "valid message" },
          ] as Array<Message>,
          description: "whitespace-only messages",
        },
        nullish: {
          input: [
            { role: "user" as const, content: null as unknown as string },
            { role: "user" as const, content: undefined as unknown as string },
            { role: "user" as const, content: "valid message" },
          ] as Array<Message>,
          expected: [
            { role: "user" as const, content: "valid message" },
          ] as Array<Message>,
          description: "null/undefined content",
        },
      }

      /**
       * Shared test function for empty message handling
       */
      function runEmptyMessageTest(
        testCase: keyof typeof emptyMessageTestCases,
      ) {
        const fixture = emptyMessageTestCases[testCase]

        it(`should filter out ${fixture.description}`, async () => {
          // Create context with test messages
          const context = createMockContext({
            messages: fixture.input,
            model: "gpt-4",
          })

          // Process messages
          await runHandler(context)

          // Verify correct filtering
          expect(createChatCompletionsMock).toHaveBeenCalledWith(
            expect.objectContaining({
              messages: fixture.expected,
            }),
          )
        })
      }

      // Run the tests using the test function
      runEmptyMessageTest("whitespace")
      runEmptyMessageTest("nullish")
    })

    /**
     * Test error handling capabilities
     */
    describe("Error Handling", () => {
      // Declare test variables
      let testContext: MockContext

      // Set up before each error test
      beforeEach(() => {
        setupMocks()

        // Create simple test context
        testContext = createMockContext({
          messages: [{ role: "user", content: "hello" }],
          model: "gpt-4",
        })
      })

      /**
       * Test HTTP error handling
       */
      describe("HTTP Errors", () => {
        // Test data for HTTP error
        const errorResponse = {
          status: 400,
          text: () => Promise.resolve('{"error": "Bad request"}'),
        } as Response

        let responseJsonMock: ReturnType<typeof mock>

        beforeEach(() => {
          // Set up HTTP error mock
          createChatCompletionsMock.mockImplementation(() => {
            throw new HTTPError("API Error", errorResponse)
          })

          // Set up response mock
          responseJsonMock = mock((data: unknown, _status?: number) => data)
          testContext.json = responseJsonMock
        })

        it("should handle API errors correctly", async () => {
          // Execute handler
          await handleCompletion(testContext as unknown as Context)

          // Verify error response
          expect(responseJsonMock).toHaveBeenCalledWith(
            expect.objectContaining({ error: '{"error": "Bad request"}' }),
            400,
          )
        })
      })

      /**
       * Test standard JS error handling
       */
      describe("Standard Errors", () => {
        beforeEach(() => {
          // Configure mock to throw regular Error
          createChatCompletionsMock.mockImplementation(() => {
            throw new Error("Regular error")
          })
        })

        it("should re-throw non-API errors", async () => {
          // Verify error is properly propagated
          // Use expect().rejects.toThrow directly to avoid await_thenable warning
          const result = runHandler(testContext)
          // eslint-disable-next-line @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression
          await expect(result).rejects.toThrow("Regular error")
        })
      })
    })

    /**
     * Test rate limiting enforcement
     */
    describe("Rate Limiting", () => {
      // Declare test variables
      let calls: Array<string>
      let testContext: MockContext

      // Set up before each rate limit test
      beforeEach(() => {
        // Reset tracking and mocks
        calls = []
        setupMocks()

        // Configure tracking mocks
        checkRateLimitMock.mockImplementation(() => {
          calls.push("rateLimit")
          return Promise.resolve()
        })

        createChatCompletionsMock.mockImplementation(() => {
          calls.push("api")
          return Promise.resolve({
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Test response",
                },
                logprobs: null,
                finish_reason: "stop",
              },
            ],
            id: "test-id",
            object: "chat.completion",
            created: Date.now(),
            model: "gpt-4",
          })
        })

        // Create test context
        testContext = createMockContext({
          messages: [{ role: "user", content: "hello" }],
          model: "gpt-4",
        })
      })

      /**
       * Verify rate limiting is checked before API calls
       */
      it("should check rate limit before processing", async () => {
        // Execute handler using the helper function
        await runHandler(testContext)

        // Verify mocks were called
        const rateLimitCalls = checkRateLimitMock.mock.calls.length
        const apiCalls = createChatCompletionsMock.mock.calls.length

        expect(rateLimitCalls).toBeGreaterThan(0)
        expect(apiCalls).toBeGreaterThan(0)

        // Verify execution order through our tracking array
        expect(calls).toEqual(["rateLimit", "api"])
      })
    })

    // End of Handler Tests group
  })
})
