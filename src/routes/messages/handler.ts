import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { sanitizeForCopilotBackend, isClaude } from "~/lib/sanitize"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createMessages } from "~/services/copilot/create-messages"

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

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Route Claude models to native Anthropic passthrough
  if (isClaude(anthropicPayload.model)) {
    return handleNativeAnthropic(c, anthropicPayload)
  }

  // Non-Claude models: use existing OpenAI translation path
  return handleOpenAITranslation(c, anthropicPayload)
}

/**
 * Native Anthropic passthrough for Claude models.
 * Sends requests directly to Copilot's /v1/messages endpoint.
 * Responses are in Anthropic format already - no translation needed.
 */
async function handleNativeAnthropic(
  c: Context,
  payload: AnthropicMessagesPayload,
) {
  consola.debug("Using native Anthropic passthrough for model:", payload.model)

  const sanitized = sanitizeForCopilotBackend(
    payload as unknown as Record<string, unknown>,
  )
  consola.debug("Sanitized payload:", JSON.stringify(sanitized).slice(0, 500))

  const response = await createMessages(sanitized)

  if (!payload.stream) {
    // Non-streaming: Copilot returns Anthropic JSON directly
    const body = await response.json()
    consola.debug(
      "Native non-streaming response:",
      JSON.stringify(body).slice(-400),
    )
    return c.json(body)
  }

  // Streaming: Copilot returns Anthropic SSE format - pipe through directly
  consola.debug("Native streaming response - piping SSE directly")

  // Set SSE headers
  c.header("Content-Type", "text/event-stream")
  c.header("Cache-Control", "no-cache")
  c.header("Connection", "keep-alive")

  // Pipe the upstream SSE response body directly to the client
  if (!response.body) {
    return c.text("No response body", 500)
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

/**
 * Existing OpenAI translation path for non-Claude models (GPT, etc.)
 */
async function handleOpenAITranslation(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) {
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
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
