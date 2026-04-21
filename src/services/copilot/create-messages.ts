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

function hasAgentMessages(payload: Record<string, unknown>): boolean {
  const messages = payload.messages as
    | Array<Record<string, unknown>>
    | undefined
  if (!messages) return false
  return messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role as string),
  )
}
