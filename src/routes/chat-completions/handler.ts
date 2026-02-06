import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { modelSupportsResponses } from "~/lib/model-capabilities"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createResponsesStreamState,
  translateChatToResponses,
  translateResponsesEventToChatChunks,
  translateResponsesToChat,
} from "~/routes/responses/translation"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResponse,
  type ResponsesStreamEvent,
} from "~/services/copilot/create-responses"

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

  const useResponses = modelSupportsResponses(payload.model)

  const response =
    useResponses ?
      await createResponses(translateChatToResponses(payload))
    : await createChatCompletions(payload)

  if (useResponses && isResponsesNonStreaming(response)) {
    const translated = translateResponsesToChat(response)
    consola.debug("Non-streaming response:", JSON.stringify(translated))
    return c.json(translated)
  }

  if (!useResponses && isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    if (useResponses) {
      const streamState = createResponsesStreamState(payload.model)

      for await (const rawEvent of response as AsyncIterable<unknown>) {
        const streamEvent = toStreamEvent(rawEvent)
        if (!streamEvent?.data) {
          continue
        }

        if (streamEvent.data === "[DONE]") {
          break
        }

        let eventData: ResponsesStreamEvent
        try {
          eventData = JSON.parse(streamEvent.data) as ResponsesStreamEvent
        } catch {
          continue
        }

        const eventType = eventData.type ?? streamEvent.event
        const chunks = translateResponsesEventToChatChunks(
          eventData,
          eventType,
          streamState,
        )

        for (const chunk of chunks) {
          consola.debug("Streaming chunk:", JSON.stringify(chunk))
          await stream.writeSSE({ data: JSON.stringify(chunk) })
        }

        if (streamState.completed) {
          break
        }
      }

      await stream.writeSSE({ data: "[DONE]" })
      return
    }

    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponsesNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")

type StreamEvent = {
  data?: string
  event?: string
}

const toStreamEvent = (rawEvent: unknown): StreamEvent | null => {
  if (!rawEvent || typeof rawEvent !== "object") {
    return null
  }

  const event = rawEvent as { data?: unknown; event?: unknown }
  const data = typeof event.data === "string" ? event.data : undefined
  const eventName = typeof event.event === "string" ? event.event : undefined

  if (!data && !eventName) {
    return null
  }

  return { data, event: eventName }
}
