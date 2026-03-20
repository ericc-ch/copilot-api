import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createChatCompletionsViaResponses } from "~/services/copilot/create-responses"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import {
  translateChunkToAnthropicEvents,
  translateErrorToAnthropicErrorEvent,
} from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  let openAIPayload = translateToOpenAI(anthropicPayload)

  // Find the selected model for limits lookup
  const selectedModel = state.models?.data.find(
    (model) => model.id === openAIPayload.model,
  )

  // Fill in max_tokens if not provided, using model's max output tokens as default
  if (isNullish(openAIPayload.max_tokens)) {
    openAIPayload = {
      ...openAIPayload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", openAIPayload.max_tokens)
  }

  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  // Some models (e.g. gpt-5.4, gpt-5.x-codex) only support /responses, not
  // /chat/completions. Route them through the responses adapter instead.
  const supportedEndpoints = selectedModel?.supported_endpoints ?? []
  const useResponsesEndpoint =
    supportedEndpoints.length > 0 &&
    supportedEndpoints.includes("/responses") &&
    !supportedEndpoints.includes("/chat/completions")

  if (useResponsesEndpoint) {
    consola.info(
      `Model "${openAIPayload.model}" only supports /responses — routing via responses adapter`,
    )
  }

  const response = useResponsesEndpoint
    ? await createChatCompletionsViaResponses(openAIPayload)
    : await createChatCompletions(openAIPayload)

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

    // Anthropic SDK expects a ping event at the start of the stream
    await stream.writeSSE({
      event: "ping",
      data: JSON.stringify({ type: "ping" }),
    })

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      try {
        const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
        const events = translateChunkToAnthropicEvents(chunk, streamState)

        for (const event of events) {
          consola.debug("Translated Anthropic event:", JSON.stringify(event))
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      } catch (err) {
        consola.error("Error processing stream chunk:", err)
        // Send an Anthropic-formatted error event so clients don't hang
        const errorEvent = translateErrorToAnthropicErrorEvent()
        await stream.writeSSE({
          event: errorEvent.type,
          data: JSON.stringify(errorEvent),
        })
        break
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
