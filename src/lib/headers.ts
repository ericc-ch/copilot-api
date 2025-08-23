import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

export type HeaderMode = "savings" | "compatible"

export interface RequestHeaders {
  "X-Initiator": "user" | "agent"
}

/**
 * Generate headers based on mode
 */
export function generateSessionHeaders(
  payload: ChatCompletionsPayload,
  mode: HeaderMode,
): RequestHeaders {
  const initiatorMap: Record<
    HeaderMode,
    (payload: ChatCompletionsPayload) => "user" | "agent"
  > = {
    savings: getSavingsInitiator,
    compatible: getCompatibleInitiator,
  }
  return {
    "X-Initiator": initiatorMap[mode](payload),
  }
}

/**
 * Check if a message role is an agent role
 */
function isAgentRole(role: string): boolean {
  return ["assistant", "tool"].includes(role)
}

/**
 * Savings mode: if any message is assistant or tool, then it is agent
 */
function getSavingsInitiator(
  payload: ChatCompletionsPayload,
): "user" | "agent" {
  return payload.messages.some((msg) => isAgentRole(msg.role)) ? "agent" : "user"
}

/**
 * Compatible mode: if last message is user then it is user
 */
function getCompatibleInitiator(
  payload: ChatCompletionsPayload,
): "user" | "agent" {
  const lastMessage = payload.messages.at(-1)
  return lastMessage?.role === "user" ? "user" : "agent"
}
