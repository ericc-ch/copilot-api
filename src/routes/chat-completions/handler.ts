import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { recordTokenUsage } from "~/lib/token-store"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

type TokenEstimate = { input: number; output: number } | null

const estimateTokens = async (
  payload: ChatCompletionsPayload,
): Promise<TokenEstimate> => {
  const model = state.models?.data.find((m) => m.id === payload.model)
  if (!model) {
    consola.warn("No model selected, skipping token count calculation")
    return null
  }
  try {
    const count = await getTokenCount(payload, model)
    consola.info("Current token count:", count)
    return count
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
    return null
  }
}

const parseChunkUsage = (chunk: SSEMessage): ChatCompletionChunk["usage"] => {
  if (!chunk.data || chunk.data === "[DONE]") return undefined
  if (typeof chunk.data !== "string") return undefined
  try {
    const parsed = JSON.parse(chunk.data) as ChatCompletionChunk
    return parsed.usage
  } catch {
    return undefined
  }
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  const estimated = await estimateTokens(payload)

  if (state.manualApprove) await awaitApproval()

  const selectedModel = state.models?.data.find((m) => m.id === payload.model)

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  if (payload.stream) {
    payload = { ...payload, stream_options: { include_usage: true } }
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    const inputTokens = response.usage?.prompt_tokens ?? estimated?.input ?? 0
    const outputTokens =
      response.usage?.completion_tokens ?? estimated?.output ?? 0
    recordTokenUsage(payload.model, inputTokens, outputTokens)
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    let lastUsage: ChatCompletionChunk["usage"] | undefined

    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
      lastUsage = parseChunkUsage(chunk as SSEMessage) ?? lastUsage
    }

    recordTokenUsage(
      payload.model,
      lastUsage?.prompt_tokens ?? estimated?.input ?? 0,
      lastUsage?.completion_tokens ?? estimated?.output ?? 0,
    )
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
