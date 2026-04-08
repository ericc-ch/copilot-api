import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesApiResponse
}

export interface ResponsesPayload {
  model: string
  input: unknown
  instructions?: string | null
  max_output_tokens?: number | null
  previous_response_id?: string | null
  reasoning?: Record<string, unknown> | null
  store?: boolean | null
  stream?: boolean | null
  temperature?: number | null
  text?: Record<string, unknown> | null
  tool_choice?: string | Record<string, unknown> | null
  tools?: Array<Record<string, unknown>> | null
  top_p?: number | null
  truncation?: string | null
  user?: string | null
  metadata?: Record<string, unknown> | null
}

export interface ResponsesApiResponse {
  id: string
  object: string
  model: string
  status: string
}
