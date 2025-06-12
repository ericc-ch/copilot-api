import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { state } from "~/lib/state"

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  for (const message of payload.messages) {
    intoCopilotMessage(message)
  }

  const visionEnable = payload.messages.some(
    (x) =>
      (x.content && typeof x.content !== "string")
      && x.content.some((x) => x.type === "image_url"),
  )

  // Check if tools are being used
  const toolsEnable = Boolean(payload.tools && payload.tools.length > 0)

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers: copilotHeaders(state, visionEnable),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()

    // If tools are not supported, provide a helpful error message
    if (toolsEnable && response.status === 400) {
      throw new HTTPError(
        `Failed to create chat completions. GitHub Copilot may not support tool calls. Error: ${errorText}`,
        response
      )
    }

    throw new HTTPError(`Failed to create chat completions: ${errorText}`, response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

const intoCopilotMessage = (message: Message) => {
  // Skip processing for assistant messages (they may have tool_calls)
  if (message.role === "assistant") return false

  // Skip processing for tool messages (they have specific format)
  if (message.role === "tool") return false

  // Skip processing for string content
  if (typeof message.content === "string") return false

  // Skip processing for null content
  if (message.content === null) return false

  // Transform content parts for vision support
  for (const part of message.content) {
    if (part.type === "input_image") part.type = "image_url"
  }
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
  tool_calls?: Array<DeltaToolCall>
}

interface DeltaToolCall {
  index: number
  id?: string
  type?: "function"
  function?: {
    name?: string
    arguments?: string
  }
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
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
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter"
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
  tools?: Array<Tool>
  tool_choice?: "none" | "auto" | ToolChoice
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface ToolChoice {
  type: "function"
  function: {
    name: string
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool"
  content: string | Array<ContentPart> | null
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
  name?: string
}

// https://platform.openai.com/docs/api-reference

export interface ContentPart {
  type: "input_image" | "input_text" | "image_url"
  text?: string
  image_url?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

// https://platform.openai.com/docs/guides/images-vision#giving-a-model-images-as-input
// Note: copilot use "image_url", but openai use "input_image"
