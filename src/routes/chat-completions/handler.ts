import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import {
  setRequestModel,
  setResolvedModel,
  setResponseModel,
} from "~/lib/request-logger"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  usesMaxCompletionTokens,
} from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  setRequestModel(c, payload.model)
  setResolvedModel(c, payload.model)
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
    const defaultMaxTokens =
      selectedModel?.capabilities.limits.max_output_tokens
    payload =
      usesMaxCompletionTokens(payload.model) ?
        {
          ...payload,
          max_completion_tokens: defaultMaxTokens,
        }
      : {
          ...payload,
          max_tokens: defaultMaxTokens,
        }

    consola.debug(
      "Set output token limit to:",
      JSON.stringify(defaultMaxTokens),
    )
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    setResponseModel(c, response.model)
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return new Response(response, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
