import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { state } from "~/lib/state"

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Prepare headers and include vision request flag
  const headers = copilotHeaders(state)
  headers["Copilot-Vision-Request"] = JSON.stringify({ enable: true })
  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok)
    throw new HTTPError("Failed to create chat completions", response)

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

// Streaming types

export interface ChatCompletionChunk {
  choices: [Choice]
  created: number
  object: "chat.completion.chunk"
  id: string
  model: string
}

interface Delta {
  content?: string
  role?: string
  tool_calls?: ToolCall[]
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "tool_calls" | null
  logprobs: null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: [ChoiceNonStreaming]
}

interface ChoiceNonStreaming {
  index: number
  message: Message
  logprobs: null
  finish_reason: "stop" | "tool_calls"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: Array<string>
  n?: number
  stream?: boolean
  tools?: Tool[]
  tool_choice?: string | { type: string; function?: { name: string } }
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: object
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

// https://platform.openai.com/docs/api-reference
