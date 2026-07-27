import type {
  AnthropicImageBlock,
  AnthropicMessagesPayload,
  AnthropicToolResultBlock,
} from "~/routes/messages/anthropic-types"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

function hasImage(payload: AnthropicMessagesPayload): boolean {
  return payload.messages.some(
    (message) =>
      Array.isArray(message.content)
      && message.content.some(
        (block): block is AnthropicImageBlock => block.type === "image",
      ),
  )
}

function isAgentCall(payload: AnthropicMessagesPayload): boolean {
  return payload.messages.some(
    (message) =>
      message.role === "assistant"
      || (Array.isArray(message.content)
        && message.content.some(
          (block): block is AnthropicToolResultBlock =>
            block.type === "tool_result",
        )),
  )
}

export async function createAnthropicMessages(
  payload: AnthropicMessagesPayload,
  forwardedHeaders: Record<string, string>,
  query = "",
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/v1/messages${query}`, {
    method: "POST",
    headers: {
      ...copilotHeaders(state, hasImage(payload)),
      ...forwardedHeaders,
      "X-Initiator": isAgentCall(payload) ? "agent" : "user",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Failed to create Anthropic message", response)
  }

  return response
}
