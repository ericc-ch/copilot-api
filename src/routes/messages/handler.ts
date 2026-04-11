import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { recordTokenUsage } from "~/lib/token-store"
import { getTokenCount } from "~/lib/tokenizer"
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

  let openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Calculate estimated token count as fallback for streaming with no usage data
  const selectedModel = state.models?.data.find(
    (model) => model.id === openAIPayload.model,
  )
  let estimatedTokenCount: { input: number; output: number } | null = null
  try {
    if (selectedModel) {
      estimatedTokenCount = await getTokenCount(openAIPayload, selectedModel)
    }
  } catch {
    // non-critical, ignore
  }

  // Request usage data in streaming responses
  if (openAIPayload.stream) {
    openAIPayload = {
      ...openAIPayload,
      stream_options: { include_usage: true },
    }
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )

    const inputTokens =
      response.usage?.prompt_tokens ?? estimatedTokenCount?.input ?? 0
    const outputTokens =
      response.usage?.completion_tokens ?? estimatedTokenCount?.output ?? 0
    recordTokenUsage(openAIPayload.model, inputTokens, outputTokens)

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

    let lastUsage: ChatCompletionChunk["usage"] | undefined

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      if (chunk.usage) lastUsage = chunk.usage

      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    recordTokenUsage(
      openAIPayload.model,
      lastUsage?.prompt_tokens ?? estimatedTokenCount?.input ?? 0,
      lastUsage?.completion_tokens ?? estimatedTokenCount?.output ?? 0,
    )
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
