import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getResponsesTokenCount } from "~/lib/tokenizer"
import {
  createResponses,
  type ResponsesApiResponse,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ResponsesPayload>()
  consola.debug("Responses payload:", JSON.stringify(payload).slice(-400))

  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  try {
    if (selectedModel) {
      const tokenCount = await getResponsesTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (payload.max_output_tokens == null) {
    payload = {
      ...payload,
      max_output_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug(
      "Set max_output_tokens to:",
      JSON.stringify(payload.max_output_tokens),
    )
  }

  const response = await createResponses(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming responses response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming responses response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Responses streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesApiResponse => !Object.hasOwn(response, Symbol.asyncIterator)
