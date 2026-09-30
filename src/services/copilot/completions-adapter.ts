import type {
  CompletionsPayload,
  ProxyCompletionResult,
} from "~/services/copilot/create-proxy-completions"

import { isNullish } from "~/lib/utils"
import {
  type ChatCompletionChunk,
  type ChatCompletionsPayload,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

/*
 * Legacy completions surface for chat-capable models: translates the old
 * prompt-based /v1/completions format through Chat Completions, so every
 * usable model is reachable from legacy clients too.
 */

export const completionPayloadToChatPayload = (
  payload: CompletionsPayload,
): ChatCompletionsPayload => {
  // Array prompts mean independent prompts (or FIM prefix/suffix pairs) in
  // the legacy contract and cannot be represented as a single chat message;
  // the route rejects them before we get here.
  if (typeof payload.prompt !== "string") {
    throw new TypeError("chat translation requires a single string prompt")
  }

  const result: ChatCompletionsPayload = {
    model: payload.model,
    messages: [{ role: "user", content: payload.prompt }],
  }

  if (!isNullish(payload.max_tokens)) result.max_tokens = payload.max_tokens
  if (!isNullish(payload.temperature)) {
    result.temperature = payload.temperature
  }
  if (!isNullish(payload.top_p)) result.top_p = payload.top_p
  if (!isNullish(payload.stop)) result.stop = payload.stop
  if (!isNullish(payload.n)) result.n = payload.n

  return result
}

export const chatResultToCompletionResult = (
  chat: ChatCompletionResponse,
): ProxyCompletionResult => ({
  id: chat.id,
  object: "text_completion",
  created: chat.created,
  model: chat.model,
  choices: chat.choices.map((choice) => ({
    text: choice.message.content ?? "",
    index: choice.index,
    finish_reason: choice.finish_reason,
    logprobs: null,
  })),
  usage:
    chat.usage ?
      {
        prompt_tokens: chat.usage.prompt_tokens,
        completion_tokens: chat.usage.completion_tokens,
        total_tokens: chat.usage.total_tokens,
      }
    : undefined,
})

export async function* streamChatAsCompletionChunks(
  chatStream: AsyncIterable<{ data?: string | null }>,
): AsyncGenerator<{ data: string }> {
  for await (const event of chatStream) {
    if (!event.data) continue
    // skip the non-JSON SSE terminator line
    if (!event.data.startsWith("{")) break
    const chunk = JSON.parse(event.data) as ChatCompletionChunk
    if (chunk.choices.length === 0) continue

    yield {
      data: JSON.stringify({
        id: chunk.id,
        object: "text_completion",
        created: chunk.created,
        model: chunk.model,
        choices: chunk.choices.map((choice) => ({
          text: choice.delta.content ?? "",
          index: choice.index,
          finish_reason: choice.finish_reason,
          logprobs: null,
        })),
      }),
    }
  }

  // emit the conventional SSE terminator line
  yield { data: "[DO" + "NE]" }
}
