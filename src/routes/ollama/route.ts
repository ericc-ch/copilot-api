import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { forwardError } from "~/lib/forward-error"
import { isNullish } from "~/lib/is-nullish"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { createChatCompletions } from "~/services/copilot/create-chat-completions"
import { getModels } from "~/services/copilot/get-models"

// Import types from separate type file
import type {
  OllamaChatPayload,
  OllamaChatResponse,
  OllamaChatStreamChunk,
  OllamaListModelsResponse,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "./types"

export const ollamaRoutes = new Hono()

/**
 * Ollama compatible chat completion endpoint
 * Compatible with Ollama's /api/chat endpoint
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
 */
ollamaRoutes.post("/chat", async (c) => {
  try {
    // Get the Ollama-formatted request
    const ollamaPayload = await c.req.json<OllamaChatPayload>()

    console.info("Ollama request:", ollamaPayload)

    // Check rate limit
    await checkRateLimit(state)

    // Get messages from the payload
    const messages = ollamaPayload.messages

    console.info("Current token count:", getTokenCount(messages))

    // Check if manual approval is required
    if (state.manualApprove) await awaitApproval()

    // Convert Ollama request to OpenAI format
    const openAIPayload = mapOllamaToOpenAIPayload(ollamaPayload)

    // Default max_tokens if not provided
    if (isNullish(openAIPayload.max_tokens)) {
      const selectedModel = state.models?.data.find(
        (model) => model.id === openAIPayload.model,
      )

      if (selectedModel?.capabilities.limits.max_output_tokens) {
        openAIPayload.max_tokens =
          selectedModel.capabilities.limits.max_output_tokens
      }
    }

    const response = await createChatCompletions(openAIPayload)

    // Handle non-streaming response
    if (isNonStreaming(response)) {
      return c.json(mapOpenAIToOllamaResponse(response))
    }

    // Handle streaming response
    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of response) {
          try {
            // Parse the SSE message (if needed) and send stream chunk
            const parsedChunk = parseChunk(chunk)
            if (shouldSendChunk(parsedChunk)) {
              const ollamaChunk = mapOpenAIToOllamaStreamChunk(parsedChunk)
              await stream.writeSSE({ data: JSON.stringify(ollamaChunk) })
            }
          } catch (e) {
            console.error("Error processing stream chunk:", e)
          }
        }

        // Send final chunk with done: true
        await stream.writeSSE({
          data: JSON.stringify(createFinalChunk(ollamaPayload.model)),
        })
      } catch (streamError) {
        console.error("Error in stream processing:", streamError)
        await stream.writeSSE({
          data: JSON.stringify({ error: "Stream processing error" }),
        })
      }
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

/**
 * Ollama compatible list models endpoint
 * Compatible with Ollama's /api/tags endpoint
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models
 */
ollamaRoutes.get("/tags", async (c) => {
  try {
    // Get models from OpenAI API
    const modelsResponse = await getModels()

    // Convert OpenAI format to Ollama format
    const ollamaModelsResponse = mapOpenAIToOllamaModels(modelsResponse)

    return c.json(ollamaModelsResponse)
  } catch (error) {
    return await forwardError(c, error)
  }
})

// ============= Helper functions =============

/**
 * Maps Ollama request payload to OpenAI format
 */
function mapOllamaToOpenAIPayload(ollamaPayload: OllamaChatPayload) {
  return {
    model: ollamaPayload.model || "gpt-4o",
    // Convert message format to comply with OpenAI API
    messages: ollamaPayload.messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role,
        content: msg.content,
      }),
    ),
    stream: ollamaPayload.stream !== false, // Default to streaming if not specified
    max_tokens: ollamaPayload.max_tokens,
    temperature: ollamaPayload.options?.temperature,
    top_p: ollamaPayload.options?.top_p,
    frequency_penalty: ollamaPayload.options?.frequency_penalty,
    presence_penalty: ollamaPayload.options?.presence_penalty,
    stop: ollamaPayload.options?.stop,
  }
}

/**
 * Maps OpenAI response to Ollama format for non-streaming responses
 */
function mapOpenAIToOllamaResponse(
  response: ChatCompletionResponse,
): OllamaChatResponse {
  return {
    model: response.model,
    created_at: formatISODateWithZ(response.created),
    message: {
      role: response.choices[0].message.role,
      content: response.choices[0].message.content || "",
    },
    done: true,
    total_duration: 0, // These values aren't available in the OpenAI response
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  }
}

/**
 * Maps OpenAI models to Ollama models format
 */
function mapOpenAIToOllamaModels(
  modelsResponse: Awaited<ReturnType<typeof getModels>>,
): OllamaListModelsResponse {
  return {
    models: modelsResponse.data.map((model) => ({
      name: model.id,
      modified_at: formatISODateWithZ(Date.now() / 1000),
      size: 0, // We don't have size information in OpenAI API
      digest: "", // We don't have digest information in OpenAI API
      details: {
        format: "gguf",
        family: determineModelFamily(model.id),
        families: null,
        parameter_size: determineModelSize(model.id),
        quantization_level: "Q4_0",
      },
    })),
  }
}

/**
 * Determines model family based on model ID
 */
function determineModelFamily(modelId: string): string {
  if (modelId.includes("gpt-4")) return "gpt-4"
  if (modelId.includes("gpt-3.5")) return "gpt-3.5"
  if (modelId.includes("gpt")) return "gpt"
  return "unknown"
}

/**
 * Determines model size based on model ID
 */
function determineModelSize(modelId: string): string {
  if (modelId.includes("gpt-4")) return "175B"
  if (modelId.includes("gpt-3.5")) return "7B"
  return "unknown"
}

/**
 * Maps OpenAI streaming chunk to Ollama format
 */
function mapOpenAIToOllamaStreamChunk(
  chunk: ChatCompletionChunk,
): OllamaChatStreamChunk {
  return {
    model: chunk.model,
    created_at: formatISODateWithOffset(chunk.created),
    message: {
      role: chunk.choices[0].delta.role || "assistant",
      content: chunk.choices[0].delta.content || "",
    },
    done: false,
  }
}

/**
 * Creates final chunk with done: true for streaming responses
 */
function createFinalChunk(model: string): OllamaChatStreamChunk {
  return {
    model,
    created_at: formatISODateWithZ(),
    message: {
      role: "assistant",
      content: "",
    },
    done: true,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  }
}

/**
 * Parses chunk from SSE response
 */
function parseChunk(chunk: Record<string, unknown>): ChatCompletionChunk {
  // If the chunk already has the right format, return it
  if (chunk.choices && chunk.model) {
    return chunk as ChatCompletionChunk
  }

  // If it's an SSE message with data property, parse it
  if (chunk.data && typeof chunk.data === "string") {
    try {
      return JSON.parse(chunk.data) as ChatCompletionChunk
    } catch (e) {
      console.warn("Could not parse chunk data", e)
    }
  }

  return chunk as ChatCompletionChunk
}

/**
 * Checks if a chunk should be sent to the client
 */
function shouldSendChunk(chunk: ChatCompletionChunk): boolean {
  return Boolean(chunk.choices[0]?.delta?.content)
}

/**
 * Checks if response is non-streaming
 */
function isNonStreaming(
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse {
  return !("next" in response)
}

// Define padding function outside the date formatting function for better scope
const padWithZero = (num: number): string => num.toString().padStart(2, "0")

/**
 * Formats date with timezone offset for streaming responses
 * Format: 2023-08-04T08:52:19.385406455-07:00
 */
function formatISODateWithOffset(timestamp?: number): string {
  const date = timestamp ? new Date(timestamp * 1000) : new Date()

  // Check if the date is valid before formatting
  if (Number.isNaN(date.getTime())) {
    return new Date()
      .toLocaleString("en-US", {
        timeZoneName: "longOffset",
      })
      .replace(" GMT", "")
      .replaceAll("/", "-")
  }

  const year = date.getFullYear()
  const month = padWithZero(date.getMonth() + 1)
  const day = padWithZero(date.getDate())
  const hours = padWithZero(date.getHours())
  const minutes = padWithZero(date.getMinutes())
  const seconds = padWithZero(date.getSeconds())
  const ms = date.getMilliseconds().toString().padStart(3, "0")

  // Get timezone offset in hours and minutes
  const tzOffset = date.getTimezoneOffset()
  const tzHours = padWithZero(Math.abs(Math.floor(tzOffset / 60)))
  const tzMinutes = padWithZero(Math.abs(tzOffset % 60))
  const tzSign = tzOffset <= 0 ? "+" : "-"

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}000000${tzSign}${tzHours}:${tzMinutes}`
}

/**
 * Formats date with Z for UTC format for non-streaming responses
 * Format: 2023-12-13T22:42:50.203334Z
 */
function formatISODateWithZ(timestamp?: number): string {
  const date = timestamp ? new Date(timestamp * 1000) : new Date()

  // Check if the date is valid before formatting
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace(/\.\d+Z$/, ".000000Z")
  }

  return date.toISOString().replace(/\.\d+Z$/, ".000000Z")
}
