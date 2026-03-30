import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { isNullish } from "~/lib/utils"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  consola.debug(
    "Responses API request payload:",
    JSON.stringify(payload).slice(-400),
  )

  // Set default max_output_tokens from model capabilities
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_output_tokens)) {
    payload.max_output_tokens =
      selectedModel?.capabilities.limits.max_output_tokens
    consola.debug("Set max_output_tokens to:", payload.max_output_tokens)
  }

  const response = await createResponses(payload)

  // Non-streaming: response is a JSON object with "object" field
  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming responses result:",
      JSON.stringify(response).slice(-400),
    )
    return c.json(response)
  }

  // Streaming: forward SSE events directly from Copilot
  consola.debug("Streaming responses result")
  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      consola.debug("Responses stream event:", JSON.stringify(rawEvent))

      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      // Extract event type from the data for the SSE event field
      try {
        const parsed = JSON.parse(rawEvent.data) as { type?: string }
        await stream.writeSSE({
          event: parsed.type ?? rawEvent.event ?? "message",
          data: rawEvent.data,
        })
      } catch {
        await stream.writeSSE({
          event: rawEvent.event ?? "message",
          data: rawEvent.data,
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is Record<string, unknown> => Object.hasOwn(response, "object")
