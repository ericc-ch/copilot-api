import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createAnthropicMessages } from "~/services/copilot/create-anthropic-messages"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResult,
} from "~/services/copilot/create-responses"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import { selectCopilotMessagesEndpoint } from "./endpoint-selection"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
} from "./responses-stream-translation"
import {
  translateAnthropicToResponses,
  translateResponsesToAnthropic,
} from "./responses-translation"
import {
  createAnthropicStreamState,
  finalizeAnthropicStream,
  translateChunkToAnthropicEvents,
} from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const selectedModel = state.models?.data.find(
    (model) => model.id === anthropicPayload.model,
  )
  const endpoint = selectCopilotMessagesEndpoint(
    selectedModel?.supported_endpoints,
  )
  if (!endpoint) {
    return c.json(
      {
        error: {
          message: `Model "${anthropicPayload.model}" does not support the Copilot Messages, Responses, or Chat Completions endpoints`,
          type: "invalid_request_error",
        },
      },
      400,
    )
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  if (endpoint === "/v1/messages") {
    const forwardedHeaders: Record<string, string> = {}
    for (const [name, value] of c.req.raw.headers) {
      if (name.toLowerCase().startsWith("anthropic-")) {
        forwardedHeaders[name] = value
      }
    }
    return await createAnthropicMessages(
      anthropicPayload,
      forwardedHeaders,
      new URL(c.req.url).search,
    )
  }

  if (endpoint === "/responses") {
    return await handleResponses(c, anthropicPayload)
  }

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
    const streamState = createAnthropicStreamState()

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

    for (const event of finalizeAnthropicStream(streamState)) {
      consola.debug("Translated Anthropic event:", JSON.stringify(event))
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  })
}

async function handleResponses(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) {
  const responsesPayload = translateAnthropicToResponses(anthropicPayload)
  consola.debug(
    "Translated Responses request payload:",
    JSON.stringify(responsesPayload),
  )
  const response = await createResponses(
    responsesPayload,
    isAgentRequest(anthropicPayload) ? "agent" : "user",
  )

  if (isResponsesResult(response)) {
    return c.json(translateResponsesToAnthropic(response))
  }

  return streamSSE(c, async (stream) => {
    const streamState = createResponsesStreamState()
    for await (const rawEvent of response) {
      if (rawEvent.data === "[DONE]") break
      if (!rawEvent.data) continue

      const event: unknown = JSON.parse(rawEvent.data)
      if (typeof event !== "object" || event === null) continue

      for (const translated of translateResponsesStreamEvent(
        event as Record<string, unknown>,
        streamState,
      )) {
        consola.debug(
          "Translated Anthropic Responses event:",
          JSON.stringify(translated),
        )
        await stream.writeSSE({
          event: translated.type,
          data: JSON.stringify(translated),
        })
      }
    }
  })
}

function isAgentRequest(payload: AnthropicMessagesPayload): boolean {
  return payload.messages.some(
    (message) =>
      message.role === "assistant"
      || (Array.isArray(message.content)
        && message.content.some((block) => block.type === "tool_result")),
  )
}

function isResponsesResult(
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResult {
  return Object.hasOwn(response, "output")
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
