import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

import { thinkingTypeReplacements } from "./thinking-type"

// Sends Anthropic Messages requests to Copilot's native /v1/messages endpoint
// without translation, because the /chat/completions translation drops
// `thinking` and `output_config.effort`. Only a thinking type that Copilot
// rejects is changed, in a copy of the payload.

export interface NativeMessagesPayload {
  model: string
  messages: Array<{ role: string; content: unknown }>
  thinking?: { type: string; display?: string }
  output_config?: { effort?: string }
}

// Also looks inside nested content, e.g. images in tool_result blocks.
function contentHasBlock(content: unknown, type: string): boolean {
  return (
    Array.isArray(content)
    && content.some(
      (block: unknown) =>
        typeof block === "object"
        && block !== null
        && "type" in block
        && (block.type === type
          || ("content" in block && contentHasBlock(block.content, type))),
    )
  )
}

function payloadHasBlock(
  payload: NativeMessagesPayload,
  type: string,
): boolean {
  return payload.messages.some((message) =>
    contentHasBlock(message.content, type),
  )
}

function isAgentCall(payload: NativeMessagesPayload): boolean {
  return (
    payload.messages.some((message) => message.role === "assistant")
    || payloadHasBlock(payload, "tool_result")
  )
}

function withThinkingType(
  payload: NativeMessagesPayload,
  type: string,
): NativeMessagesPayload {
  if (payload.thinking?.type === type) return payload
  const display = payload.thinking?.display
  return { ...payload, thinking: { type, ...(display ? { display } : {}) } }
}

function requestSummary(payload: NativeMessagesPayload): string {
  return (
    `model=${payload.model}`
    + ` thinking=${JSON.stringify(payload.thinking ?? null)}`
    + ` effort=${JSON.stringify(payload.output_config?.effort ?? null)}`
  )
}

function postMessages(
  payload: NativeMessagesPayload,
  anthropicHeaders: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state, payloadHasBlock(payload, "image")),
    "X-Initiator": isAgentCall(payload) ? "agent" : "user",
    "anthropic-version": "2023-06-01",
    ...anthropicHeaders,
  }
  return fetch(`${copilotBaseUrl(state)}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
}

// `anthropicHeaders` holds the client's anthropic-version and anthropic-beta.
export async function createNativeMessages(
  payload: NativeMessagesPayload,
  anthropicHeaders: Record<string, string>,
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const requested = payload.thinking?.type
  const request = requested ? { model: payload.model, requested } : undefined
  const sent =
    request ? thinkingTypeReplacements.typeToSend(request) : undefined
  let body = sent ? withThinkingType(payload, sent) : payload
  consola.info(`Native /v1/messages: ${requestSummary(body)}`)
  let response = await postMessages(body, anthropicHeaders)

  const retryType =
    response.status === 400 && request && sent ?
      thinkingTypeReplacements.retryType(
        request,
        sent,
        await response.clone().text(),
      )
    : undefined
  if (request && retryType) {
    body = withThinkingType(payload, retryType)
    consola.info(`Native /v1/messages: retry: ${requestSummary(body)}`)
    response = await postMessages(body, anthropicHeaders)
    if (response.ok) thinkingTypeReplacements.remember(request, retryType)
  }

  if (!response.ok) {
    consola.error(
      `Failed to create native messages: HTTP ${response.status}`,
      await response.clone().text(),
    )
    throw new HTTPError("Failed to create native messages", response)
  }
  return response
}
