import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  // Normalize max_completion_tokens to max_tokens for upstream compatibility
  const payloadAny = payload as unknown as Record<string, unknown>
  if (
    payloadAny.max_completion_tokens !== null
    && payloadAny.max_completion_tokens !== undefined
    && isNullish(payload.max_tokens)
  ) {
    payload = {
      ...payload,
      max_tokens: payloadAny.max_completion_tokens as number,
    }
    delete (payload as unknown as Record<string, unknown>).max_completion_tokens
    consola.debug(
      "Normalized max_completion_tokens to max_tokens:",
      payload.max_tokens,
    )
  } else if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const response = await createChatCompletions(payload)

  // Streaming: response is a raw fetch Response — pipe body directly
  if (response instanceof Response) {
    const startTime = Date.now()
    let byteCount = 0
    let chunkCount = 0

    const monitor = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk: Uint8Array, controller) {
        chunkCount++
        byteCount += chunk.byteLength
        if (chunkCount === 1) {
          consola.info(`TTFT: ${Date.now() - startTime}ms`)
        }
        controller.enqueue(chunk)
      },
      flush() {
        consola.info(
          `Stream complete: ${chunkCount} chunks, ${byteCount} bytes in ${Date.now() - startTime}ms`,
        )
      },
    })

    const body = response.body
    if (!body) {
      return c.text("No response body", 502)
    }

    return new Response(body.pipeThrough(monitor), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  // Non-streaming: response is a parsed JSON object
  consola.debug("Non-streaming response:", JSON.stringify(response))
  return c.json(response)
}
