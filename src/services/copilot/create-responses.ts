import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Some newer models (the GPT reasoning family: gpt-5.x/6.x, mai-code, ...)
// are only reachable through Copilot's Responses API - /chat/completions
// rejects them with "not accessible via the /chat/completions endpoint".
// See Model["supported_endpoints"] in get-models.ts, which is how a caller
// knows to reach for this instead of create-chat-completions.
export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const isAgentCall = payload.input.some(
    (item) =>
      item.type === "function_call" || item.type === "function_call_output",
  )

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create response", response)
    throw new HTTPError("Failed to create response", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesResult
}

// Request types

export interface ResponsesPayload {
  model: string
  input: Array<ResponseInputItem>
  instructions?: string | null
  max_output_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  stream?: boolean | null
  tools?: Array<ResponseTool> | null
  tool_choice?:
    "none" | "auto" | "required" | { type: "function"; name: string } | null
  reasoning?: { effort: string } | null
}

export type ResponseInputItem =
  | ResponseMessageItem
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem

export interface ResponseMessageItem {
  type: "message"
  role: "system" | "developer" | "user" | "assistant"
  content: Array<ResponseContentPart>
}

export interface ResponseFunctionCallItem {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

export interface ResponseFunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string
}

export type ResponseContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string }

export interface ResponseTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

// Result types (non-streaming)

export interface ResponsesResult {
  id: string
  object: "response"
  created_at: number
  model: string
  status: "completed" | "incomplete" | "failed" | "in_progress"
  output: Array<ResponseOutputItem>
  usage?: ResponsesUsage
}

export type ResponseOutputItem =
  | {
      type: "message"
      id: string
      role: "assistant"
      status: string
      content: Array<{ type: "output_text"; text: string }>
    }
  | {
      type: "function_call"
      id: string
      call_id: string
      name: string
      arguments: string
      status: string
    }

export interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: { cached_tokens?: number }
}

// Streaming event types - only the ones we translate; unknown types are
// forwarded as no-ops by the translator.

export type ResponseStreamEvent =
  | { type: "response.created"; response: ResponsesResult }
  | { type: "response.in_progress"; response: ResponsesResult }
  | {
      type: "response.output_item.added"
      output_index: number
      item: ResponseOutputItem
    }
  | {
      type: "response.output_item.done"
      output_index: number
      item: ResponseOutputItem
    }
  | {
      type: "response.output_text.delta"
      item_id: string
      output_index: number
      delta: string
    }
  | { type: "response.output_text.done"; item_id: string }
  | {
      type: "response.function_call_arguments.delta"
      item_id: string
      output_index: number
      delta: string
    }
  | { type: "response.function_call_arguments.done"; item_id: string }
  | { type: "response.completed"; response: ResponsesResult }
  | { type: "response.incomplete"; response: ResponsesResult }
  | { type: "response.failed"; response: ResponsesResult }

// The Responses API has many more event types than we translate above
// (response.content_part.*, response.output_text.done, ...). The stream
// translator's `default` switch branch is a no-op for anything that isn't
// one of the literal members of ResponseStreamEvent - the single `as
// ResponseStreamEvent` assertion at the JSON.parse call site is what lets
// an unrecognized `type` reach that default branch instead of failing to
// compile.
