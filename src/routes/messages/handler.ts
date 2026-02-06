import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { modelSupportsResponses } from "~/lib/model-capabilities"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponsesStreamState,
  translateChatToResponses,
  translateResponsesEventToChatChunks,
  translateResponsesToChat,
} from "~/routes/responses/translation"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResponse,
  type ResponsesStreamEvent,
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

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const useResponses = modelSupportsResponses(openAIPayload.model)
  const response =
    useResponses ?
      await createResponses(translateChatToResponses(openAIPayload))
    : await createChatCompletions(openAIPayload)

  const nonStreaming = buildNonStreamingResponse(response, useResponses)
  if (nonStreaming) {
    return c.json(nonStreaming)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState = createAnthropicStreamState()
    if (useResponses) {
      await streamResponsesToAnthropic({
        response: response as AsyncIterable<unknown>,
        model: openAIPayload.model,
        stream,
        streamState,
      })
      return
    }

    await streamChatToAnthropic(
      response as AsyncIterable<unknown>,
      stream,
      streamState,
    )
  })
}

type SSEStream = {
  writeSSE: (message: { event?: string; data: string }) => Promise<void>
}

type AnthropicStreamEvent = ReturnType<
  typeof translateChunkToAnthropicEvents
>[number]

type StreamEvent = {
  data?: string
  event?: string
}

const createAnthropicStreamState = (): AnthropicStreamState => ({
  messageStartSent: false,
  contentBlockIndex: 0,
  contentBlockOpen: false,
  toolCalls: {},
})

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

const writeAnthropicEvents = async (
  stream: SSEStream,
  events: Array<AnthropicStreamEvent>,
) => {
  for (const event of events) {
    consola.debug("Translated Anthropic event:", JSON.stringify(event))
    await stream.writeSSE({
      event: event.type,
      data: JSON.stringify(event),
    })
  }
}

const buildNonStreamingResponse = (
  response:
    | Awaited<ReturnType<typeof createChatCompletions>>
    | Awaited<ReturnType<typeof createResponses>>,
  useResponses: boolean,
): ReturnType<typeof translateToAnthropic> | null => {
  if (useResponses && isResponsesNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const openAIResponse = translateResponsesToChat(response)
    const anthropicResponse = translateToAnthropic(openAIResponse)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return anthropicResponse
  }

  if (!useResponses && isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return anthropicResponse
  }

  return null
}

const streamResponsesToAnthropic = async (options: {
  response: AsyncIterable<unknown>
  model: string
  stream: SSEStream
  streamState: AnthropicStreamState
}) => {
  const responseStreamState = createResponsesStreamState(options.model)

  for await (const rawEvent of options.response) {
    consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
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
      responseStreamState,
    )

    for (const chunk of chunks) {
      const events = translateChunkToAnthropicEvents(chunk, options.streamState)
      await writeAnthropicEvents(options.stream, events)
    }

    if (responseStreamState.completed) {
      break
    }
  }
}

const streamChatToAnthropic = async (
  response: AsyncIterable<unknown>,
  stream: SSEStream,
  streamState: AnthropicStreamState,
) => {
  for await (const rawEvent of response) {
    consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
    const streamEvent = toStreamEvent(rawEvent)
    if (!streamEvent?.data) {
      continue
    }

    if (streamEvent.data === "[DONE]") {
      break
    }

    let chunk: ChatCompletionChunk
    try {
      chunk = JSON.parse(streamEvent.data) as ChatCompletionChunk
    } catch {
      continue
    }

    const events = translateChunkToAnthropicEvents(chunk, streamState)
    await writeAnthropicEvents(stream, events)
  }
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponsesNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")
