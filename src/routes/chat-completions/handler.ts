import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { recordRequest, recordTokenUsage } from "~/lib/metrics"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

// Helper function to format duration as H:MM:SS
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }
  return `0:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

// Helper function to format timestamp in local timezone
function formatTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const startTime = Date.now()
  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const response = await createChatCompletions(payload)

  // Record request
  recordRequest(payload.model, "chat-completions")

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))

    // Record token usage for non-streaming responses
    if (response.usage) {
      const endTime = Date.now()
      const duration = (endTime - startTime) / 1000 // in seconds
      const speed =
        duration > 0 ? response.usage.completion_tokens / duration : 0
      const timestamp = formatTimestamp(new Date())
      const timeFormatted = formatDuration(duration)
      const contextSize =
        selectedModel?.capabilities.limits.max_context_window_tokens ?? "N/A"

      recordTokenUsage(
        response.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      )
      console.log(
        `${timestamp} - INFO - Tokens - Model: ${response.model}, In: ${response.usage.prompt_tokens}, Out: ${response.usage.completion_tokens}, Ctx: ${contextSize}, Time: ${timeFormatted}, Speed: ${speed.toFixed(2)} t/s`,
      )
    }

    return c.json(response)
  }

  consola.debug("Streaming response")

  // For streaming responses, we'll accumulate token counts
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))

      // Parse chunk data to extract usage information
      if (chunk.data && chunk.data !== "[DONE]") {
        try {
          const parsed = JSON.parse(chunk.data) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number }
          }
          if (parsed.usage) {
            totalPromptTokens = parsed.usage.prompt_tokens ?? totalPromptTokens
            totalCompletionTokens =
              parsed.usage.completion_tokens ?? totalCompletionTokens
          }
        } catch {
          // Ignore parsing errors
        }
      }

      await stream.writeSSE(chunk as SSEMessage)
    }

    // Record token usage after streaming completes
    if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
      const endTime = Date.now()
      const duration = (endTime - startTime) / 1000 // in seconds
      const speed = duration > 0 ? totalCompletionTokens / duration : 0
      const timestamp = formatTimestamp(new Date())
      const timeFormatted = formatDuration(duration)
      const contextSize =
        selectedModel?.capabilities.limits.max_context_window_tokens ?? "N/A"

      recordTokenUsage(payload.model, totalPromptTokens, totalCompletionTokens)
      console.log(
        `${timestamp} - INFO - Tokens - Model: ${payload.model}, In: ${totalPromptTokens}, Out: ${totalCompletionTokens}, Ctx: ${contextSize}, Time: ${timeFormatted}, Speed: ${speed.toFixed(2)} t/s`,
      )
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
