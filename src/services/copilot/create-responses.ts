import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export interface ResponsesPayload {
  model: string
  instructions?: string
  input?: string | Array<ResponseInputMessage>
  stream?: boolean | null
  tools?: Array<ResponseTool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  reasoning?: {
    effort?: "low" | "medium" | "high" | "xhigh"
    summary?: "auto" | "none"
  }
  max_output_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  seed?: number | null
  stop?: string | Array<string> | null
  store?: boolean | null
  parallel_tool_calls?: boolean | null
  user?: string | null
}

export interface ResponseInputMessage {
  role: "user" | "assistant" | "tool"
  content: Array<ResponseInputContent>
}

export type ResponseInputContent =
  | {
      type: "input_text"
      text: string
    }
  | {
      type: "input_image"
      image_url: {
        url: string
        detail?: "low" | "high" | "auto"
      }
    }
  | {
      type: "tool_call"
      id: string
      name: string
      arguments: string
    }
  | {
      type: "tool_result"
      tool_call_id: string
      output: string
      is_error?: boolean
    }

export interface ResponseTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
  strict?: boolean
}

export interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface ResponsesResponse {
  id: string
  object: "response"
  created?: number
  model: string
  output: Array<ResponsesOutputItem>
  usage?: ResponsesUsage
}

export type ResponsesOutputItem =
  | {
      type: "output_text"
      text: string
    }
  | {
      type: "function_call"
      id: string
      name: string
      arguments: string
    }
  | {
      type: "tool_call"
      id: string
      name: string
      arguments: string
    }
  | {
      type: "message"
      role?: "assistant" | "tool"
      content: Array<ResponsesMessageContent>
    }

export type ResponsesMessageContent =
  | {
      type: "output_text"
      text: string
    }
  | {
      type: "function_call"
      id: string
      name: string
      arguments: string
    }
  | {
      type: "tool_call"
      id: string
      name: string
      arguments: string
    }

export interface ResponsesStreamEvent {
  type?: string
  delta?: string
  text?: string
  output_index?: number
  item_id?: string
  item?: ResponsesOutputItem
  response?: ResponsesResponse
}

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision =
    Array.isArray(payload.input)
    && payload.input.some((message) =>
      message.content.some((part) => part.type === "input_image"),
    )

  const isAgentCall =
    Array.isArray(payload.input)
    && payload.input.some((message) =>
      ["assistant", "tool"].includes(message.role),
    )

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

  return (await response.json()) as ResponsesResponse
}
