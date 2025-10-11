import { expect, mock } from "bun:test"

import type { SSEMatcher } from "../test-types"

// ============================================================================
// Fixtures
// ============================================================================

export function* asyncIterableFrom<T>(items: Array<T>): Iterable<T> {
  for (const item of items) {
    yield item
  }
}

export const GEMINI_PRO_URL = "/v1beta/models/gemini-pro:generateContent"

// ============================================================================
// Mocks
// ============================================================================

export interface MockChatCompletionsModule {
  createChatCompletions: (payload?: unknown) => unknown
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
  return mock.module("~/lib/rate-limit", () => ({
    checkRateLimit: (_: unknown) => {},
  }))
}

// ============================================================================
// Stream Response Builders
// ============================================================================

/**
 * Mock downstream to return non-streaming JSON response
 */
export async function mockDownstreamJSONResponse(obj: unknown) {
  await mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => obj,
  }))
}

type ChunkInput = string | Record<string, unknown>

/**
 * Mock downstream to return streaming chunks
 */
export function mockDownstreamStreamChunks(chunks: Array<ChunkInput>) {
  const toData = (c: ChunkInput) =>
    typeof c === "string" ? c : JSON.stringify(c)
  const events = chunks.map((c) => ({ data: toData(c) }))

  void mock.module("~/services/copilot/create-chat-completions", () => ({
    createChatCompletions: () => asyncIterableFrom(events),
  }))
}

// ============================================================================
// Stream Chunk Builders
// ============================================================================

interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

const defaultUsage: Usage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
}

export const streamChunks = {
  text(id: string, content: string, usage?: Usage) {
    return {
      id,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
      usage: usage ?? defaultUsage,
    }
  },

  finish(id: string, usage?: Usage) {
    return {
      id,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: usage ?? defaultUsage,
    }
  },

  toolArgs(
    id: string,
    options: {
      name?: string
      arguments: string
      index?: number
    },
  ) {
    const toolCall: {
      index: number
      type: "function"
      function: { name?: string; arguments: string }
    } = {
      index: options.index ?? 0,
      type: "function",
      function: { arguments: options.arguments },
    }

    if (options.name) {
      toolCall.function.name = options.name
    }

    return {
      id,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [toolCall],
          },
          finish_reason: null,
        },
      ],
      usage: defaultUsage,
    }
  },

  done() {
    return "[DONE]"
  },
}

// ============================================================================
// Request Helpers
// ============================================================================

export async function requestStream(opts?: {
  endpoint?: string
  headers?: Record<string, string>
  body?: unknown
}): Promise<{ res: Response }> {
  void createMockRateLimit()
  const { server } = (await import("~/server")) as {
    server: {
      request: (
        url: string,
        opts: { method: string; headers: Record<string, string>; body: string },
      ) => Promise<Response>
    }
  }

  const endpoint =
    opts?.endpoint ?? "/v1beta/models/gemini-pro:streamGenerateContent"
  const headers = opts?.headers ?? { "content-type": "application/json" }
  const body = JSON.stringify(
    opts?.body ?? { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
  )

  const res = await server.request(endpoint, { method: "POST", headers, body })
  return { res }
}

// ============================================================================
// SSE Assertions
// ============================================================================

export function expectOKEventStream(res: Response): void {
  expect(res.status).toBe(200)
  const ct = res.headers.get("content-type") ?? ""
  expect(ct).toContain("text/event-stream")
}

export async function readSSE(res: Response): Promise<string> {
  return await res.text()
}

function parseSSE(body: string): Array<{ data: string }> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => ({ data: line.slice(5).trim() }))
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

    expect(allData.includes(`"functionCall":{"name":"${name}"`)).toBe(true)

    if (hasArgs) {
      expect(
        allData.includes(`"functionCall":{"name":"${name}","args":{`),
      ).toBe(true)
    }

    if (completeArgs) {
      const argsPattern = `"functionCall":{"name":"${name}","args":{`
      expect(allData.includes(argsPattern)).toBe(true)
      const argsStart = allData.indexOf(argsPattern)
      expect(argsStart).toBeGreaterThan(-1)
      const afterArgs = allData.slice(argsStart + argsPattern.length)
      expect(afterArgs.includes("}")).toBe(true)
    }
  }

  if (matcher.textMatch) {
    const { pattern, minOccurrences = 1 } = matcher.textMatch
    if (typeof pattern === "string") {
      const count = (allData.match(new RegExp(pattern, "g")) || []).length
      expect(count).toBeGreaterThanOrEqual(minOccurrences)
    } else {
      const matches = allData.match(pattern) || []
      expect(matches.length).toBeGreaterThanOrEqual(minOccurrences)
    }
  }

  if (matcher.jsonContains) {
    expect(allData.includes(matcher.jsonContains)).toBe(true)
  }
}
