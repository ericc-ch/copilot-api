import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { recordRequest, recordTokenUsage } from "~/lib/metrics"
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
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  // Record request
  recordRequest(openAIPayload.model, "messages")

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )

    // Record token usage for non-streaming responses
    if (response.usage) {
      recordTokenUsage(
        response.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      )
      consola.info(
        `Tokens (Anthropic) - Model: ${response.model}, In: ${response.usage.prompt_tokens}, Out: ${response.usage.completion_tokens}`,
      )
    }

    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")

  // For streaming responses, we'll accumulate token counts
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

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

      // Extract usage information from chunks
      if (chunk.usage) {
        totalPromptTokens = chunk.usage.prompt_tokens
        totalCompletionTokens = chunk.usage.completion_tokens
      }

      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    // Record token usage after streaming completes
    if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
      recordTokenUsage(
        openAIPayload.model,
        totalPromptTokens,
        totalCompletionTokens,
      )
      consola.info(
        `Tokens (Anthropic streaming) - Model: ${openAIPayload.model}, In: ${totalPromptTokens}, Out: ${totalCompletionTokens}`,
      )
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
