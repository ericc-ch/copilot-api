import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { modelSessionHeaders } from "~/services/copilot/create-model-session"

// Responses API payloads are forwarded as-is (model, input, instructions,
// tools, stream, ...). The raw upstream Response is returned so streaming
// (SSE) bodies can be piped through untouched.
export interface ResponsesPayload {
  model: string
  [key: string]: unknown
}

export interface ResponsesRequestOptions {
  /** attach the copilot-vision-request header for image inputs */
  vision?: boolean
  /** mirrors the chat path's X-Initiator semantics */
  initiator?: "user" | "agent"
}

export const createResponses = async (
  payload: ResponsesPayload,
  options: ResponsesRequestOptions = {},
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const sessionHeaders = await modelSessionHeaders(payload.model)

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers: {
      ...copilotHeaders(state, options.vision ?? false),
      "X-Initiator": options.initiator ?? "user",
      ...sessionHeaders,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create responses", response)

  return response
}
