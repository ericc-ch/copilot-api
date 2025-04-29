import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { isNullish } from "~/lib/is-nullish"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import { HTTPError } from "~/lib/http-error"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()

  // --- Message Sanitization Block ---
  // The Copilot API expects clean, string-based content. This block ensures compliance.
  payload.messages = payload.messages
    .map((msg) => {
      // Step 1: Flatten Content
      // Some clients send content as an array of parts (e.g., [{type: 'text', text: '...'}]).
      // We need to convert this into a single string.
      const raw = msg.content as unknown
      const flat = Array.isArray(raw)
        ? raw
            // Extract text from object parts or stringify other parts
            .map((part: any) => (part && typeof part === 'object' && 'text' in part ? (part as any).text : String(part)))
            .join('') // Join all parts into one string
        : String(raw ?? '') // Handle non-array content (string, null, undefined)

      // Step 2: Strip Internal Markup Tags
      // Remove tags used internally by clients but not intended for the final model.
      const cleaned = flat
        // Remove <environment_details> blocks entirely (tags + content) as they contain debug info.
        .replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '')
        // Remove only the <task> tags, preserving the user's instruction content within.
        .replace(/<\/?task>/g, '')
        // Step 3: Trim Whitespace
        .trim()

      // Return the message with sanitized content
      return { role: msg.role, content: cleaned }
    })
    // Step 4: Filter Empty Messages
    // Remove messages that might have become empty after sanitization.
    .filter((msg) => {
      if (!msg.content) {
        consola.warn('Dropping empty message after sanitization')
        return false
      }
      return true
    })
  // --- End Sanitization Block ---

  consola.info("Current token count:", getTokenCount(payload.messages))

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    const selectedModel = state.models?.data.find(
      (model) => model.id === payload.model,
    )

    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
  }

  // Call Copilot API and handle HTTP errors with detailed logging
  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await createChatCompletions(payload)
  } catch (err: unknown) {
    if (err instanceof HTTPError) {
      const body = await err.response.text()
      consola.error('Copilot API error:', body)
      return c.json({ error: body }, err.response.status as any)
    }
    throw err
  }

  if (isNonStreaming(response)) {
    return c.json(response)
  }

  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
