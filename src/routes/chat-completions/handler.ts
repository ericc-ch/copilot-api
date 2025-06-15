import type { Context } from "hono"

import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { detectFormat, anthropicToOpenAI, openAIToAnthropic } from "~/lib/format-converter"
import { isNullish } from "~/lib/is-nullish"
import { transformModelName } from "~/lib/models"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createChatCompletions } from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const originalPayload = await c.req.json()



  // Detect and convert format if needed
  const formatInfo = detectFormat(originalPayload)
  const payload = formatInfo.isAnthropic
    ? anthropicToOpenAI(originalPayload)
    : originalPayload







  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens) && payload.model) {
    // Transform model name to internal format for lookup
    const internalModelName = transformModelName(payload.model)
    const selectedModel = state.models?.data.find(
      (model) => model.id === internalModelName,
    )

    if (selectedModel?.capabilities?.limits?.max_output_tokens) {
      payload.max_tokens = selectedModel.capabilities.limits.max_output_tokens
    }
  }

  const response = await createChatCompletions(payload, formatInfo.originalFormat)

  if (isNonStreaming(response)) {
    // Convert response back to original format if needed
    const finalResponse = openAIToAnthropic(response, formatInfo.originalFormat)
    return c.json(finalResponse)
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of response as AsyncIterable<any>) {
        // Check if connection is still alive
        if (stream.closed) {
          break
        }

        await stream.writeSSE(chunk as SSEMessage)
      }
    } catch (error) {
      // Send error event to client if connection is still open
      if (!stream.closed) {
        try {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: "Stream interrupted" }),
          })
        } catch {
          // Ignore write errors to closed streams
        }
      }
    } finally {
      // Ensure stream is properly closed
      if (!stream.closed) {
        try {
          await stream.writeSSE({ event: "done", data: "[DONE]" })
        } catch {
          // Ignore close errors
        }
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is Record<string, any> => {
  return (
    response
    && typeof response === "object"
    && (Object.hasOwn(response, "choices")
      || Object.hasOwn(response, "content")) // Support both OpenAI and Anthropic formats
    && !response[Symbol.asyncIterator] // Not an async iterable
  )
}
