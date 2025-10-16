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

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

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
      recordTokenUsage(
        response.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      )
      consola.info(
        `Tokens - Model: ${response.model}, In: ${response.usage.prompt_tokens}, Out: ${response.usage.completion_tokens}`,
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
      recordTokenUsage(payload.model, totalPromptTokens, totalCompletionTokens)
      consola.info(
        `Tokens (streaming) - Model: ${payload.model}, In: ${totalPromptTokens}, Out: ${totalCompletionTokens}`,
      )
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
