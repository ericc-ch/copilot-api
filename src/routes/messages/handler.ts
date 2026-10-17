import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

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
  if (consola.level >= 4) {
    consola.debug(
      "Anthropic request payload:",
      JSON.stringify(anthropicPayload),
    )
  }

  const openAIPayload = translateToOpenAI(anthropicPayload)
  if (consola.level >= 4) {
    consola.debug(
      "Translated OpenAI request payload:",
      JSON.stringify(openAIPayload),
    )
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  if (openAIPayload.stream) {
    consola.debug("Streaming response from Copilot")
    return streamSSE(
      c,
      async (stream) => {
        const controller = new AbortController()
        stream.onAbort(() => {
          controller.abort()
        })

        const response = await createChatCompletions(
          openAIPayload,
          controller.signal,
        )
        if (isNonStreaming(response)) {
          throw new Error("Expected a streaming response from Copilot")
        }

        try {
          await writeStreamingResponse(stream, response)
        } finally {
          controller.abort()
        }
      },
      (error) => {
        if (error.name !== "AbortError") {
          consola.error("Streaming request failed:", error)
        }
        return Promise.resolve()
      },
    )
  }

  const response = await createChatCompletions(openAIPayload)
  if (!isNonStreaming(response)) {
    throw new Error("Expected a non-streaming response from Copilot")
  }

  if (consola.level >= 4) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
  }
  const anthropicResponse = translateToAnthropic(response)
  if (consola.level >= 4) {
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
  }
  return c.json(anthropicResponse)
}

async function writeStreamingResponse(
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
  response: Exclude<
    Awaited<ReturnType<typeof createChatCompletions>>,
    ChatCompletionResponse
  >,
): Promise<void> {
  const streamState: AnthropicStreamState = {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  }

  for await (const rawEvent of response) {
    if (consola.level >= 4) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
    }
    if (rawEvent.data === "[DONE]") {
      break
    }

    if (!rawEvent.data) {
      continue
    }

    const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
    const events = translateChunkToAnthropicEvents(chunk, streamState)

    for (const event of events) {
      if (consola.level >= 4) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
      }
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  }
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
