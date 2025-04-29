import { encodeChat } from "gpt-tokenizer"
import consola from "consola"

import type { Message } from "~/services/copilot/create-chat-completions"

/**
 * Ensures that the `content` field of each message is a string.
 * This is crucial because functions like `encodeChat` expect string content.
 * If content is not a string (e.g., null, undefined, or potentially an array
 * if called before handler sanitization), it converts it to an empty string
 * or logs a warning.
 *
 * @param messages - Array of messages potentially with non-string content.
 * @returns Array of messages where `content` is guaranteed to be a string.
 */
const sanitizeMessages = (messages: Array<Message>): Array<Message> => {
  return messages.map((msg, index) => {
    if (typeof msg.content !== "string") {
      // Log a warning if content isn't a string, as this might indicate
      // an issue upstream if it happens often.
      consola.warn(
        `Message at index ${index} had non-string content during tokenization:`, msg.content)
      // Convert non-string content to an empty string to prevent errors in encodeChat.
      return { ...msg, content: String(msg.content ?? "") }
    }
    return msg // Return unchanged if content is already a string.
  })
}

/**
 * Calculates the number of tokens for input and output messages separately.
 * Uses the `gpt-tokenizer` library which provides approximate token counts.
 *
 * @param messages - The array of messages (potentially unsanitized).
 * @returns An object containing the token count for `input` and `output` messages.
 */
export const getTokenCount = (messages: Array<Message>) => {
  // Ensure messages have string content before passing to encodeChat.
  const sanitizedMessages = sanitizeMessages(messages)

  // Separate messages by role to count input (user/system) and output (assistant).
  const input = sanitizedMessages.filter((m) => m.role !== "assistant")
  const output = sanitizedMessages.filter((m) => m.role === "assistant")

  // Use encodeChat with a specific model context (e.g., "gpt-4o") to get token arrays.
  // The length of the array approximates the token count.
  // TODO: Consider making the model used for tokenization configurable or dynamically determined.
  const inputTokens = encodeChat(input, "gpt-4o").length
  const outputTokens = encodeChat(output, "gpt-4o").length

  return {
    input: inputTokens,
    output: outputTokens,
  }
}
