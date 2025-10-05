import { mock, expect } from "bun:test"

import type {
  TestServer,
  MockChatCompletionsModule,
  MockRateLimitModule,
  MockTokenCountModule,
  CapturedPayload,
} from "./test-types"

export function asyncIterableFrom(
  events: Array<{ data?: string }>,
): AsyncIterable<{ data: string }> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next(): Promise<IteratorResult<{ data: string }>> {
          if (i < events.length) {
            const event = events[i++]
            return Promise.resolve({
              value: { data: event.data ?? "" },
              done: false,
            })
          }
          return Promise.resolve({
            value: undefined as unknown as { data: string },
            done: true,
          })
        },
      }
    },
  }
}

export function createMockChatCompletions(events: Array<{ data?: string }>) {
  return mock.module(
    "~/services/copilot/create-chat-completions",
    (): MockChatCompletionsModule => ({
      createChatCompletions: () => asyncIterableFrom(events),
    }),
  )
}

export function createMockRateLimit() {
  return mock.module(
    "~/lib/rate-limit",
    (): MockRateLimitModule => ({
      checkRateLimit: (_: unknown) => {},
    }),
  )
}

export function createMockTokenCount(tokens: {
  input: number
  output: number
}) {
  return mock.module(
    "~/services/copilot/get-token-count",
    (): MockTokenCountModule => ({
      getTokenCount: () => tokens,
    }),
  )
}

export async function makeStreamRequest(
  path: string,
  body: Record<string, unknown>,
  queryString?: string,
): Promise<Response> {
  const serverModule = (await import(`~/server?${queryString}`)) as {
    server: TestServer
  }
  return serverModule.server.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

export async function makeRequest(
  path: string,
  body: Record<string, unknown>,
  queryString?: string,
): Promise<Response> {
  const serverModule = (await import(`~/server?${queryString}`)) as {
    server: TestServer
  }
  return serverModule.server.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

export const commonResponseData = {
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

export const sampleGeminiRequest = {
  contents: [{ role: "user", parts: [{ text: "Hello" }] }],
}

export const sampleToolCall = {
  index: 0,
  type: "function",
  function: {
    name: "ReadFile",
    arguments: '{"absolute_path": "/path/to/file.txt"}',
  },
}

// Common URL patterns
export const GEMINI_PRO_URL = "/v1beta/models/gemini-pro:generateContent"

// Message filtering helpers
export function getMessagesByRole(
  payload: CapturedPayload,
  role: string,
): Array<{ role: string; content?: string; tool_call_id?: string }> {
  return (payload.messages ?? []).filter((m) => m.role === role)
}

export function expectMessageCounts(
  payload: CapturedPayload,
  expectations: {
    total?: number
    tool?: number
    assistant?: number
    assistantWithTools?: number
    user?: number
  },
): void {
  const messages = payload.messages ?? []

  if (expectations.total !== undefined) {
    expect(messages.length).toBeGreaterThanOrEqual(expectations.total)
  }

  if (expectations.tool !== undefined) {
    const toolMessages = getMessagesByRole(payload, "tool")
    expect(toolMessages.length).toBeGreaterThanOrEqual(expectations.tool)
  }

  if (expectations.assistant !== undefined) {
    const assistantMessages = getMessagesByRole(payload, "assistant")
    expect(assistantMessages.length).toBeGreaterThanOrEqual(
      expectations.assistant,
    )
  }

  if (expectations.assistantWithTools !== undefined) {
    const assistantWithTools = messages.filter(
      (m) => m.role === "assistant" && m.tool_calls,
    )
    expect(assistantWithTools.length).toBeGreaterThanOrEqual(
      expectations.assistantWithTools,
    )
  }

  if (expectations.user !== undefined) {
    const userMessages = getMessagesByRole(payload, "user")
    expect(userMessages.length).toBeGreaterThanOrEqual(expectations.user)
  }
}

// Tool call validation helpers
export function expectUniqueToolCallIds(
  payload: CapturedPayload,
  maxExpected?: number,
): void {
  const toolMessages = getMessagesByRole(payload, "tool")
  const toolCallIds = new Set(
    toolMessages.map((m) => m.tool_call_id).filter(Boolean),
  )

  if (maxExpected !== undefined) {
    expect(toolCallIds.size).toBeLessThanOrEqual(maxExpected)
  } else {
    expect(toolCallIds.size).toBeGreaterThan(0)
  }
}

export function expectToolCallIdFormat(payload: CapturedPayload): void {
  const messages = payload.messages ?? []
  const toolMessages = getMessagesByRole(payload, "tool")

  // Verify all tool messages have tool_call_id
  for (const toolMsg of toolMessages) {
    expect(toolMsg.tool_call_id).toBeDefined()
    expect(typeof toolMsg.tool_call_id).toBe("string")
  }

  // Verify all tool_call_ids in assistant messages are ≤40 chars
  const assistantWithTools = messages.filter(
    (m) => m.role === "assistant" && m.tool_calls,
  )
  for (const msg of assistantWithTools) {
    if (msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        expect(toolCall.id.length).toBeLessThanOrEqual(40)
      }
    }
  }
}

// SSE stream parsing and assertion helpers
export interface SSEEvent {
  event?: string
  data: string
}

export function parseSSE(body: string): Array<SSEEvent> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => ({ data: line.slice(5).trim() }))
}

export interface SSEMatcher {
  text?: string
  finishReason?: string
  usageMetadata?: boolean
  toolCall?: {
    name: string
    hasArgs?: boolean
    completeArgs?: boolean
  }
  textMatch?: {
    pattern: string | RegExp
    minOccurrences?: number
  }
  jsonContains?: string
}

export function expectSSEContains(body: string, matcher: SSEMatcher): void {
  const lines = parseSSE(body)
  const allData = lines.map((l) => l.data).join(" ")

  if (matcher.text) {
    expect(allData.includes(matcher.text)).toBe(true)
  }
  if (matcher.finishReason) {
    expect(allData.includes(`"finishReason":"${matcher.finishReason}"`)).toBe(
      true,
    )
  }
  if (matcher.usageMetadata) {
    expect(allData.includes('"usageMetadata"')).toBe(true)
  }
  if (matcher.toolCall) {
    const { name, hasArgs, completeArgs } = matcher.toolCall

    // Verify function call with name exists
    expect(allData.includes(`"functionCall":{"name":"${name}"`)).toBe(true)

    if (hasArgs) {
      // Verify args object started
      expect(
        allData.includes(`"functionCall":{"name":"${name}","args":{`),
      ).toBe(true)
    }

    if (completeArgs) {
      // Verify args object is complete (contains closing brace)
      const argsPattern = `"functionCall":{"name":"${name}","args":{`
      expect(allData.includes(argsPattern)).toBe(true)
      // Verify there's a complete args object (find closing brace after args opening)
      const argsStart = allData.indexOf(argsPattern)
      expect(argsStart).toBeGreaterThan(-1)
      const afterArgs = allData.slice(argsStart + argsPattern.length)
      expect(afterArgs.includes("}")).toBe(true)
    }
  }

  if (matcher.textMatch) {
    const { pattern, minOccurrences = 1 } = matcher.textMatch
    if (typeof pattern === "string") {
      // Count exact string occurrences
      const count = (allData.match(new RegExp(pattern, "g")) || []).length
      expect(count).toBeGreaterThanOrEqual(minOccurrences)
    } else {
      // Use regex pattern directly
      const matches = allData.match(pattern) || []
      expect(matches.length).toBeGreaterThanOrEqual(minOccurrences)
    }
  }

  if (matcher.jsonContains) {
    expect(allData.includes(matcher.jsonContains)).toBe(true)
  }
}

// Payload capture and validation helpers
export async function setupPayloadCapture(mockResponse?: {
  content?: string
  finish_reason?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}): Promise<CapturedPayload> {
  const capture: CapturedPayload = {} as CapturedPayload

  const defaultResponse = {
    id: "test-id",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: mockResponse?.content ?? "ok",
        },
        finish_reason: mockResponse?.finish_reason ?? "stop",
      },
    ],
    usage: mockResponse?.usage ?? {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  }

  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: (payload: CapturedPayload) => {
      // Copy all properties from payload to capture
      Object.assign(capture, payload)
      return defaultResponse
    },
  }))

  return capture
}

export interface ToolCleanupExpectation {
  noDuplicates?: boolean
  noEmptyFunctions?: boolean
}

export function expectToolCleanup(
  payload: CapturedPayload,
  expected: ToolCleanupExpectation,
): void {
  if (expected.noDuplicates) {
    const tools = payload.tools || []
    const names = tools.map((t) => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  }
  if (expected.noEmptyFunctions) {
    const tools = payload.tools || []
    expect(tools.every((t) => t.function.name.length > 0)).toBe(true)
  }
}

type ContentPart =
  | { text: string }
  | { functionCall: object }
  | { functionResponse: object }
export function buildRequest(opts: {
  text?: string
  contents?: Array<{ role: string; parts: Array<ContentPart> }>
  tools?: Array<unknown>
}) {
  return {
    contents: opts.contents ?? [
      { role: "user", parts: [{ text: opts.text ?? "hi" }] },
    ],
    ...(opts.tools && { tools: opts.tools }),
  }
}

// Enhanced request builder with more options
export function buildGenerateContentRequest(opts: {
  userText?: string
  model?: string
  tools?: Array<unknown>
  systemInstruction?: string
  multiTurn?: boolean
  withFunctionCall?: { name: string; args: object }
  withFunctionResponse?: { name: string; response: object }
}) {
  const contents: Array<{ role: string; parts: Array<ContentPart> }> = []

  // Add user message
  if (opts.userText) {
    contents.push({ role: "user", parts: [{ text: opts.userText }] })
  }

  // Add function call if requested
  if (opts.withFunctionCall) {
    contents.push({
      role: "model",
      parts: [
        {
          functionCall: {
            name: opts.withFunctionCall.name,
            args: opts.withFunctionCall.args,
          },
        },
      ],
    })
  }

  // Add function response if requested
  if (opts.withFunctionResponse) {
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: opts.withFunctionResponse.name,
            response: opts.withFunctionResponse.response,
          },
        },
      ],
    })
  }

  const request: Record<string, unknown> = { contents }

  if (opts.tools) {
    request.tools = opts.tools
  }

  if (opts.systemInstruction) {
    request.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  return request
}

// Model mapping assertion helper
export function assertModelMapping(
  capturedPayload: CapturedPayload,
  _inputModel: string,
  expectedModel: string,
): void {
  expect(capturedPayload.model).toBe(expectedModel)
}

// Enhanced message extraction with filters
export function extractMessages(
  payload: CapturedPayload,
  filters: {
    role?: string
    hasToolCalls?: boolean
    hasContent?: boolean
    contentContains?: string
  } = {},
): Array<{
  role: string
  content?: string
  tool_call_id?: string
  tool_calls?: unknown
}> {
  const messages = payload.messages ?? []

  return messages.filter((msg) => {
    if (filters.role && msg.role !== filters.role) return false
    if (
      filters.hasToolCalls !== undefined
      && Boolean(msg.tool_calls) !== filters.hasToolCalls
    )
      return false
    if (
      filters.hasContent !== undefined
      && Boolean(msg.content) !== filters.hasContent
    )
      return false
    if (
      filters.contentContains
      && (!msg.content || !msg.content.includes(filters.contentContains))
    )
      return false
    return true
  })
}
