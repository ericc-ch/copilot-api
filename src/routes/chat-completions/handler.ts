import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { HTTPError } from "~/lib/http-error"
import { isNullish } from "~/lib/is-nullish"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type Message,
} from "~/services/copilot/create-chat-completions"

/**
 * Interface for text content part in array-style message content
 */
interface TextPart {
  type: string
  text: string
}

/**
 * Type guard to check if an object is a text part with a text property
 */
function isTextPart(part: unknown): part is TextPart {
  return (
    part !== null
    && typeof part === "object"
    && "type" in part
    && "text" in part
    && typeof (part as TextPart).text === "string"
  )
}

/**
 * Sanitizes a single message by flattening content and removing internal markup
 */
function sanitizeMessage(msg: Message): Message {
  // Step 1: Flatten Content
  // Some clients send content as an array of parts (e.g., [{type: 'text', text: '...'}])
  const raw = msg.content
  const flat =
    Array.isArray(raw) ?
      raw
        .map((part) => {
          if (isTextPart(part)) {
            return part.text
          }
          // Safe string conversion for non-text parts
          return String(part || "")
        })
        .join("")
    : String(raw || "")

  // Step 2: Strip Internal Markup Tags
  // Remove tags used internally by clients but not intended for the final model
  const cleaned = flat
    // Remove <environment_details> blocks entirely (tags + content)
    .replaceAll(/<environment_details>[\s\S]*?<\/environment_details>/g, "")
    // Remove only the <task> tags, preserving the user's instruction content
    .replaceAll(/<\/?task>/g, "")
    // Step 3: Trim Whitespace
    .trim()

  // Return the message with sanitized content
  return { role: msg.role, content: cleaned }
}

/**
 * Sanitizes an array of messages and filters out empty ones
 */
function sanitizeMessages(messages: Array<Message>): Array<Message> {
  return messages
    .map((msg) => sanitizeMessage(msg))
    .filter((msg) => {
      if (!msg.content) {
        consola.warn("Dropping empty message after sanitization")
        return false
      }
      return true
    })
}

/**
 * Handles completion requests from the client
 */
export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()

  // Apply message sanitization
  payload.messages = sanitizeMessages(payload.messages)

  consola.info("Current token count:", getTokenCount(payload.messages))

  if (state.manualApprove) await awaitApproval()

  // Set max tokens if not provided
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
      consola.error("Copilot API error:", body)
      // Cast the status to the expected type for Hono
      return c.json(
        { error: body },
        err.response.status as 400 | 401 | 403 | 404 | 500,
      )
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

/**
 * Type guard to check if a response is a non-streaming response
 */
const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
