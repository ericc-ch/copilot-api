import { randomUUID } from "node:crypto"

import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

export type HeaderMode = "savings" | "compatible"

export interface RequestHeaders {
  "X-Initiator": "user" | "agent"
  "X-Interaction-Id"?: string
}

/**
 * Simple session manager for compatible mode
 */
class SessionManager {
  private sessionId: string = randomUUID()

  newSession(): string {
    this.sessionId = randomUUID()
    return this.sessionId
  }

  getCurrentSession(): string {
    return this.sessionId
  }
}

const sessionManager = new SessionManager()

/**
 * Generate headers based on mode
 */
export function generateSessionHeaders(
  payload: ChatCompletionsPayload,
  mode: HeaderMode,
): RequestHeaders {
  return mode === "savings" ?
      {
        "X-Initiator": getSavingsInitiator(payload),
      }
    : {
        "X-Initiator": getCompatibleInitiator(payload),
        "X-Interaction-Id": getSessionId(payload),
      }
}

/**
 * Savings mode: default behavior
 */
function getSavingsInitiator(
  payload: ChatCompletionsPayload,
): "user" | "agent" {
  return (
      payload.messages.some((msg) => ["assistant", "tool"].includes(msg.role))
    ) ?
      "agent"
    : "user"
}

/**
 * Compatible mode: replicate VS Code extension logic
 */
function getCompatibleInitiator(
  payload: ChatCompletionsPayload,
): "user" | "agent" {
  // VS Code: userInitiatedRequest = iterationNumber === 0 && !isContinuation
  const hasAssistantMessage = payload.messages.some(
    (msg) => msg.role === "assistant",
  )
  const hasToolCalls = payload.messages.some(
    (msg) => msg.tool_calls && msg.tool_calls.length > 0,
  )
  const hasToolMessages = payload.messages.some((msg) => msg.role === "tool")

  const isFirstIteration = !hasAssistantMessage
  const isContinuation = hasToolCalls || hasToolMessages

  return isFirstIteration && !isContinuation ? "user" : "agent"
}

/**
 * Detect if this is the start of a new conversation
 */
function isStartOfConversation(payload: ChatCompletionsPayload): boolean {
  const hasAssistantMessage = payload.messages.some(
    (msg) => msg.role === "assistant",
  )
  return !hasAssistantMessage
}

/**
 * Get session ID for compatible mode
 */
function getSessionId(payload: ChatCompletionsPayload): string {
  if (isStartOfConversation(payload)) {
    return sessionManager.newSession()
  }
  return sessionManager.getCurrentSession()
}
