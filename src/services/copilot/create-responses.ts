import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export interface ResponsesPayload {
  model: string
  input: string | Array<ResponseInputItem>
  instructions?: string | null
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  [key: string]: unknown
}

type ResponseInputItem = {
  type?: string
  role?: string
  content?: string | Array<{ type: string; [key: string]: unknown }>
  [key: string]: unknown
}

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = hasVisionContent(payload)
  const isAgentCall = hasAgentMessages(payload)

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
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

  return (await response.json()) as Record<string, unknown>
}

function hasVisionContent(payload: ResponsesPayload): boolean {
  if (typeof payload.input === "string") return false

  return payload.input.some((item) => {
    if (Array.isArray(item.content)) {
      return item.content.some((part) => part.type === "input_image")
    }
    return false
  })
}

function hasAgentMessages(payload: ResponsesPayload): boolean {
  if (typeof payload.input === "string") return false

  return payload.input.some((item) => {
    if (item.role === "assistant") return true
    if (item.type === "function_call_output") return true
    if (item.type === "function_call") return true
    return false
  })
}
