import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "./create-chat-completions"

/**
 * Some models (e.g. gpt-5.4, gpt-5.x-codex) only support the /responses
 * endpoint rather than /chat/completions.  This module calls /responses and
 * translates the response back into the standard chat-completions shape so the
 * rest of the proxy can treat all models uniformly.
 */

// ---------- /responses request / response types ----------

interface ResponsesInput {
  role: string
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>
}

interface ResponsesPayload {
  model: string
  input: ResponsesInput[]
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  tools?: unknown[] | null
  tool_choice?: unknown
}

interface ResponsesOutputContent {
  type: string
  text?: string
  annotations?: unknown[]
}

interface ResponsesOutputMessage {
  type: "message"
  role: "assistant"
  content: ResponsesOutputContent[]
  status: string
}

interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

interface ResponsesResponse {
  id: string
  model: string
  object: "response"
  status: string
  output: ResponsesOutputMessage[]
  usage?: ResponsesUsage
}

// ---------- streaming event types ----------

interface ResponsesStreamEvent {
  type: string
  // response.created
  response?: ResponsesResponse
  // response.output_item.added / response.output_text.delta
  item?: ResponsesOutputMessage
  output_index?: number
  content_index?: number
  delta?: string
  // response.completed
  usage?: ResponsesUsage
}

// ---------- converters ----------

function toResponsesPayload(payload: ChatCompletionsPayload): ResponsesPayload {
  const input: ResponsesInput[] = payload.messages.map((msg) => ({
    role: msg.role === "developer" ? "system" : msg.role,
    content:
      typeof msg.content === "string" || msg.content === null
        ? (msg.content ?? "")
        : msg.content.map((part) => {
            if (part.type === "text") return { type: "text", text: part.text }
            return {
              type: "image_url",
              image_url: (part as { type: "image_url"; image_url: { url: string; detail?: string } }).image_url,
            }
          }),
  }))

  // /responses API uses a flat tool format: { type, name, description, parameters }
  // whereas /chat/completions uses { type, function: { name, description, parameters } }
  const tools = payload.tools?.map((tool) => ({
    type: tool.type,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  })) ?? null

  return {
    model: payload.model,
    input,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_tokens,
    tools,
    tool_choice: payload.tool_choice,
  }
}

function responsesResponseToChatCompletion(
  res: ResponsesResponse,
  requestModel: string,
): ChatCompletionResponse {
  const text =
    res.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("") || null

  return {
    id: res.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        logprobs: null,
        finish_reason: res.status === "completed" ? "stop" : "length",
      },
    ],
    usage: res.usage
      ? {
          prompt_tokens: res.usage.input_tokens,
          completion_tokens: res.usage.output_tokens,
          total_tokens: res.usage.total_tokens,
        }
      : undefined,
  }
}

// ---------- streaming translation ----------

async function* translateResponsesStream(
  source: AsyncIterable<{ data?: string; event?: string }>,
  requestModel: string,
  responseId: string,
): AsyncGenerator<{ data: string; event?: string }> {
  const created = Math.floor(Date.now() / 1000)
  const id = responseId

  for await (const raw of source) {
    if (!raw.data || raw.data === "[DONE]") continue

    let evt: ResponsesStreamEvent
    try {
      evt = JSON.parse(raw.data) as ResponsesStreamEvent
    } catch {
      continue
    }

    if (evt.type === "response.output_text.delta" && evt.delta !== undefined) {
      const chunk: ChatCompletionChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: requestModel,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: evt.delta },
            finish_reason: null,
            logprobs: null,
          },
        ],
      }
      yield { data: JSON.stringify(chunk) }
    } else if (evt.type === "response.completed") {
      const usage = evt.response?.usage
      const chunk: ChatCompletionChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: requestModel,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: usage
          ? {
              prompt_tokens: usage.input_tokens,
              completion_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
            }
          : undefined,
      }
      yield { data: JSON.stringify(chunk) }
    }
  }

  yield { data: "[DONE]" }
}

// ---------- public entry point ----------

export const createChatCompletionsViaResponses = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const responsesPayload = toResponsesPayload(payload)

  const isAgentCall = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(responsesPayload),
  })

  if (!response.ok) {
    const body = await response.text()
    consola.error(
      `Failed to create response via /responses [model=${payload.model}]`,
      body,
    )
    throw new HTTPError("Failed to create response via /responses", response, body)
  }

  if (payload.stream) {
    const stream = events(response)
    // We need a stable id — generate one; it will be replaced once we see
    // the response.created event, but for simplicity use a fixed placeholder.
    return translateResponsesStream(stream, payload.model, `resp-${Date.now()}`)
  }

  const data = (await response.json()) as ResponsesResponse
  return responsesResponseToChatCompletion(data, payload.model)
}
