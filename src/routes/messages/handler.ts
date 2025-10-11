import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { setupPingInterval } from "~/lib/utils"
import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
} from "~/routes/messages/responses-stream-translation"
import {
  translateAnthropicMessagesToResponsesPayload,
  translateResponsesResultToAnthropic,
} from "~/routes/messages/responses-translation"
import { getResponsesRequestOptions } from "~/routes/responses/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResult,
  type ResponseStreamEvent,
} from "~/services/copilot/create-responses"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const useResponsesApi = shouldUseResponsesApi(anthropicPayload.model)

  if (state.manualApprove) {
    await awaitApproval()
  }

  if (useResponsesApi) {
    return await handleWithResponsesApi(c, anthropicPayload)
  }

  return await handleWithChatCompletions(c, anthropicPayload)
}

const RESPONSES_ENDPOINT = "/responses"

const handleWithChatCompletions = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) => {
  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const pingInterval = setupPingInterval(stream)

    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    try {
      for await (const rawEvent of response) {
        consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
        if (rawEvent.data === "[DONE]") {
          break
        }

        if (!rawEvent.data) {
          continue
        }

        const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
        const events = translateChunkToAnthropicEvents(chunk, streamState)

        for (const event of events) {
          consola.debug("Translated Anthropic event:", JSON.stringify(event))
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      }
    } finally {
      clearInterval(pingInterval)
    }
  })
}

const handleWithResponsesApi = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) => {
  const responsesPayload =
    translateAnthropicMessagesToResponsesPayload(anthropicPayload)
  consola.debug(
    "Translated Responses payload:",
    JSON.stringify(responsesPayload),
  )

  const { vision, initiator } = getResponsesRequestOptions(responsesPayload)
  const response = await createResponses(responsesPayload, {
    vision,
    initiator,
  })

  if (responsesPayload.stream && isAsyncIterable(response)) {
    consola.debug("Streaming response from Copilot (Responses API)")
    return streamSSE(c, async (stream) => {
      const pingInterval = setupPingInterval(stream)

      const streamState = createResponsesStreamState()

      try {
        for await (const chunk of response) {
          const eventName = chunk.event
          if (eventName === "ping") {
            await stream.writeSSE({ event: "ping", data: "" })
            continue
          }

          const data = chunk.data
          if (!data) {
            continue
          }

          consola.debug("Responses raw stream event:", data)

          const events = translateResponsesStreamEvent(
            JSON.parse(data) as ResponseStreamEvent,
            streamState,
          )
          for (const event of events) {
            const eventData = JSON.stringify(event)
            consola.debug("Translated Anthropic event:", eventData)
            await stream.writeSSE({
              event: event.type,
              data: eventData,
            })
          }
        }

        if (!streamState.messageCompleted) {
          consola.warn(
            "Responses stream ended without completion; sending fallback message_stop",
          )
          const fallback = { type: "message_stop" as const }
          await stream.writeSSE({
            event: fallback.type,
            data: JSON.stringify(fallback),
          })
        }
      } finally {
        clearInterval(pingInterval)
      }
    })
  }

  consola.debug(
    "Non-streaming Responses result:",
    JSON.stringify(response).slice(-400),
  )
  const anthropicResponse = translateResponsesResultToAnthropic(
    response as ResponsesResult,
  )
  consola.debug(
    "Translated Anthropic response:",
    JSON.stringify(anthropicResponse),
  )
  return c.json(anthropicResponse)
}

const shouldUseResponsesApi = (modelId: string): boolean => {
  const selectedModel = state.models?.data.find((model) => model.id === modelId)
  return (
    selectedModel?.supported_endpoints?.includes(RESPONSES_ENDPOINT) ?? false
  )
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
  Boolean(value)
  && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
