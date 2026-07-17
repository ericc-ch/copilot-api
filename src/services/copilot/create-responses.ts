import consola from "consola"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { state } from "~/lib/state"

export const createResponses = async (
  payload: ResponsesPayload,
  body = JSON.stringify(payload),
  signal?: AbortSignal,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state, containsVisionContent(payload.input)),
    "accept-encoding": "identity",
    "X-Initiator": isAgentInitiated(payload.input) ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body,
    signal,
  })

  if (!response.ok) {
    consola.error("Failed to create response", response)
  }

  return normalizeResponse(response)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const containsVisionContent = (input: unknown): boolean => {
  if (Array.isArray(input)) {
    return input.some((item) => containsVisionContent(item))
  }
  if (!isRecord(input)) return false

  return (
    input.type === "input_image"
    || input.type === "computer_screenshot"
    || Object.values(input).some((value) => containsVisionContent(value))
  )
}

const agentInitiatedInputTypes = new Set([
  "tool_search_output",
  "mcp_list_tools",
  "mcp_approval_request",
  "mcp_approval_response",
  "program",
  "program_output",
  "compaction",
])

const isAgentInitiated = (input: unknown): boolean => {
  if (!Array.isArray(input)) return false

  return input.some(
    (item) =>
      isRecord(item)
      && (item.role === "assistant"
        || item.type === "reasoning"
        || (typeof item.type === "string"
          && (agentInitiatedInputTypes.has(item.type)
            || item.type.endsWith("_call")
            || item.type.endsWith("_call_output")))),
  )
}

const normalizeResponse = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export interface ResponsesPayload {
  model: string
  input?: string | Array<ResponsesInputItem> | null
  background?: boolean | null
  conversation?: string | Record<string, unknown> | null
  include?: Array<string> | null
  instructions?: string | null
  max_output_tokens?: number | null
  max_tool_calls?: number | null
  metadata?: Record<string, unknown> | null
  parallel_tool_calls?: boolean | null
  previous_response_id?: string | null
  prompt?: Record<string, unknown> | null
  prompt_cache_key?: string | null
  reasoning?: Record<string, unknown> | null
  safety_identifier?: string | null
  service_tier?: string | null
  store?: boolean | null
  stream?: boolean | null
  temperature?: number | null
  text?: Record<string, unknown> | null
  tool_choice?: string | Record<string, unknown> | null
  tools?: Array<ResponsesTool> | null
  top_logprobs?: number | null
  top_p?: number | null
  truncation?: "auto" | "disabled" | null
  user?: string | null
  [key: string]: unknown
}

export interface ResponsesInputItem {
  type?: string
  role?: "user" | "assistant" | "system" | "developer"
  content?: string | Array<ResponsesContentPart>
  [key: string]: unknown
}

export interface ResponsesContentPart {
  type?: string
  [key: string]: unknown
}

export interface ResponsesTool {
  type: string
  [key: string]: unknown
}
