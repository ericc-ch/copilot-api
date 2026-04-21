import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
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

  if (
    isNullish(payload.max_tokens)
    && isNullish(payload.max_completion_tokens)
  ) {
    const limit = selectedModel?.capabilities.limits.max_output_tokens
    if (requiresMaxCompletionTokens(payload.model)) {
      payload = { ...payload, max_completion_tokens: limit }
      consola.debug(
        "Set max_completion_tokens (reasoning model) to:",
        JSON.stringify(limit),
      )
    } else {
      payload = { ...payload, max_tokens: limit }
      consola.debug("Set max_tokens to:", JSON.stringify(limit))
    }
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

// OpenAI's reasoning-model families (o1, o3, o4, gpt-5.x) reject
// `max_tokens` at API validation and require `max_completion_tokens`
// instead. The anchored regex matches the family prefix followed by a
// delimiter (hyphen, dot, or end of string) so "gpt-5", "gpt-5.4",
// "o1-mini" all match while "gpt-4o", "gpt-4.1", "chatgpt-5-*" do not.
// Extend this when OpenAI introduces new reasoning-only families.
const REASONING_MODEL_ID = /^(?:o[134]|gpt-5)(?:[-.]|$)/

export const requiresMaxCompletionTokens = (modelId: string | undefined) =>
  modelId !== undefined && REASONING_MODEL_ID.test(modelId)
