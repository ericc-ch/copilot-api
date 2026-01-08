import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { executeWithRateLimit } from "~/lib/rate-limit"
import {
  calculateOptimalDelay,
  logRateLimitInfo,
  parseRateLimitHeaders,
} from "~/lib/rate-limit-parser"
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
  return executeWithRateLimit(state, async () => {
    const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
    consola.debug(
      "Anthropic request payload:",
      JSON.stringify(anthropicPayload),
    )

    const openAIPayload = translateToOpenAI(anthropicPayload)
    consola.debug(
      "Translated OpenAI request payload:",
      JSON.stringify(openAIPayload),
    )

    if (state.manualApprove) {
      await awaitApproval()
    }

    const response = await createChatCompletions(openAIPayload, (headers) => {
      // Parse rate limit headers and update queue if applicable
      const rateLimitInfo = parseRateLimitHeaders(headers)
      logRateLimitInfo(rateLimitInfo)

      const optimalDelay = calculateOptimalDelay(rateLimitInfo)
      if (optimalDelay !== undefined) {
        state.requestQueue.updateRateLimit(optimalDelay)
      }
    })

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
      const streamState: AnthropicStreamState = {
        messageStartSent: false,
        contentBlockIndex: 0,
        contentBlockOpen: false,
        toolCalls: {},
      }

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
    })
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
