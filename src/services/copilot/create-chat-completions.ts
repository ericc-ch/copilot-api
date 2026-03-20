import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

/**
 * Copilot does not support external image URLs — only base64 data URIs.
 * This function downloads an external URL and converts it to a base64 data URI.
 */
async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${url}`)
  }
  const contentType = response.headers.get("content-type") ?? "image/jpeg"
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString("base64")
  return `data:${contentType};base64,${base64}`
}

/**
 * Rewrite any external image_url entries in the payload to base64 data URIs
 * so Copilot can process them.
 */
async function resolveExternalImages(
  payload: ChatCompletionsPayload,
): Promise<ChatCompletionsPayload> {
  const hasExternalUrls = payload.messages.some(
    (msg) =>
      Array.isArray(msg.content)
      && msg.content.some(
        (part) =>
          part.type === "image_url" && !part.image_url.url.startsWith("data:"),
      ),
  )

  if (!hasExternalUrls) return payload

  const resolvedMessages = await Promise.all(
    payload.messages.map(async (msg) => {
      if (!Array.isArray(msg.content)) return msg

      const resolvedContent = await Promise.all(
        msg.content.map(async (part) => {
          if (
            part.type !== "image_url"
            || part.image_url.url.startsWith("data:")
          ) {
            return part
          }
          try {
            const base64Url = await fetchImageAsBase64(part.image_url.url)
            return {
              ...part,
              image_url: { ...part.image_url, url: base64Url },
            }
          } catch (err) {
            consola.warn(
              `Failed to fetch external image, skipping: ${part.image_url.url}`,
              err,
            )
            return part
          }
        }),
      )

      return { ...msg, content: resolvedContent }
    }),
  )

  return { ...payload, messages: resolvedMessages }
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Resolve external image URLs to base64 before sending to Copilot
  const resolvedPayload = await resolveExternalImages(payload)

  const enableVision = resolvedPayload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = resolvedPayload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(resolvedPayload),
  })

  if (!response.ok) {
    const body = await response.text()
    consola.error(
      `Failed to create chat completions [model=${resolvedPayload.model}]`,
      body,
    )
    throw new HTTPError("Failed to create chat completions", response, body)
  }

  if (resolvedPayload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
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

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
