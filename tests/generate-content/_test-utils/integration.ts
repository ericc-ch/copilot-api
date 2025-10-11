import { expect, mock } from "bun:test"

import type {
  CapturedPayload,
  TestServer,
  TranslationCase,
  ToolCleanupExpectation,
} from "../test-types"

export const GEMINI_PRO_URL = "/v1beta/models/gemini-pro:generateContent"

// ============================================================================
// Payload Capture
// ============================================================================

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
      Object.assign(capture, payload)
      return defaultResponse
    },
  }))

  return capture
}

// ============================================================================
// Request Helpers
// ============================================================================

export async function makeRequest(
  path: string,
  body: Record<string, unknown>,
  queryString?: string,
): Promise<Response> {
  const query = queryString || `request-${Date.now()}`
  const serverModule = (await import(`~/server?${query}`)) as {
    server: TestServer
  }
  return serverModule.server.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ============================================================================
// Message Assertions
// ============================================================================

function getMessagesByRole(
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

// ============================================================================
// Tool Call Assertions
// ============================================================================

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

  for (const toolMsg of toolMessages) {
    expect(toolMsg.tool_call_id).toBeDefined()
    expect(typeof toolMsg.tool_call_id).toBe("string")
  }

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

export function expectToolCleanup(
  payload: CapturedPayload,
  expectations: ToolCleanupExpectation,
): void {
  const { noDuplicates, noEmptyFunctions } = expectations

  if (noDuplicates && payload.tools) {
    const toolNames = payload.tools.map((t) => t.function.name)
    const uniqueNames = new Set(toolNames)
    expect(uniqueNames.size).toBe(toolNames.length)
  }

  if (noEmptyFunctions && payload.tools) {
    const emptyFunctions = payload.tools.filter(
      (t) => !t.function.name || t.function.name.trim() === "",
    )
    expect(emptyFunctions.length).toBe(0)
  }
}

// ============================================================================
// Translation Case Builder
// ============================================================================

export function buildTranslationCase(params: {
  name: string
  contents: Array<{
    role: string
    parts: Array<{ text?: string; functionCall?: unknown }>
  }>
  systemInstruction?: unknown
  tools?: Array<unknown>
  expectMessages?: number
  expectRoles?: Array<string>
}): TranslationCase {
  return {
    name: params.name,
    input: {
      contents: params.contents,
      tools: params.tools,
      systemInstruction: params.systemInstruction,
    },
    expect: {
      messageCount: params.expectMessages,
      roles: params.expectRoles,
    },
  }
}
