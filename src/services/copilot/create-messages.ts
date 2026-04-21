import consola from "consola"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

/**
 * Send an Anthropic /v1/messages request directly to the Copilot native endpoint.
 * For Claude models, this avoids the OpenAI translation layer entirely.
 */
export const createMessages = async (
  payload: Record<string, unknown>,
): Promise<Response> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = hasImageContent(payload)

  const isAgentCall = hasAgentMessages(payload)

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const url = `${copilotBaseUrl(state)}/v1/messages`
  consola.debug("Native Anthropic request to:", url)

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    consola.error(
      "Failed to create native messages",
      response.status,
      errorBody,
    )
    throw new HTTPError("Failed to create native messages", response)
  }

  return response
}

function hasImageContent(payload: Record<string, unknown>): boolean {
  const messages = payload.messages as
    | Array<Record<string, unknown>>
    | undefined
  if (!messages) return false
  return messages.some((msg) => {
    if (!Array.isArray(msg.content)) return false
    return msg.content.some(
      (block: Record<string, unknown>) => block.type === "image",
    )
  })
}

/**
 * X-Initiator billing attribution for the Anthropic-native path.
 *   "user"  — fresh human-initiated turn (CHARGED)
 *   "agent" — tool/assistant continuation (FREE)
 *
 * Correct heuristic (mirrors closed PR #85 savings mode, and now the
 * create-chat-completions.ts sibling): inspect ONLY the last message.
 *
 * Anthropic edge case vs OpenAI shape: tool results in Anthropic come back
 * as "user"-role messages whose content array contains a `tool_result`
 * block. Without special-casing this, every Anthropic tool-continuation
 * turn would be wrongly flagged user=charged. If the last message is a
 * user-role message whose content array contains a tool_result block,
 * treat as agent.
 */
function hasAgentMessages(payload: Record<string, unknown>): boolean {
  const messages = payload.messages as
    | Array<Record<string, unknown>>
    | undefined
  if (!messages || messages.length === 0) return false
  const last = messages.at(-1)
  if (!last) return false
  if (last.role !== "user") return true
  if (Array.isArray(last.content)) {
    return last.content.some(
      (block: Record<string, unknown>) => block.type === "tool_result",
    )
  }
  return false
}
