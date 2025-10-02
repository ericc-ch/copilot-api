import { mock } from "bun:test"

import type {
  TestServer,
  MockChatCompletionsModule,
  MockRateLimitModule,
  MockTokenCountModule,
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
