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
  type ToolCall,
  type Tool,
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

      // Step 3: Handle Tool Calls
      // Preserve tool calls and ensure they have proper IDs
      const sanitizedMsg: any = { 
        role: msg.role, 
        content: cleaned || null  // Convert empty strings to null for consistency
      }
      
      if (msg.tool_calls) {
        sanitizedMsg.tool_calls = msg.tool_calls.map((toolCall, index) => ({
          ...toolCall,
          // Ensure each tool call has an ID - generate one if missing
          id: toolCall.id || `call_${Date.now()}_${index}`
        }))
      }
      
      if (msg.tool_call_id) {
        sanitizedMsg.tool_call_id = msg.tool_call_id
      }

      return sanitizedMsg
    })
    // Step 4: Filter Empty Messages
    // Remove messages that might have become empty after sanitization.
    .filter((msg) => {
      // Don't drop messages that have tool calls or tool call IDs, even if content is empty
      if (!msg.content && !msg.tool_calls && !msg.tool_call_id) {
        consola.warn('Dropping empty message after sanitization')
        return false
      }
      // Always keep messages with tool-related information
      if (msg.tool_calls || msg.tool_call_id || msg.role === 'tool') {
        return true
      }
      // For regular messages, ensure they have content
      return Boolean(msg.content && msg.content.trim())
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

  // Preserve tool-related parameters if present
  const finalPayload: ChatCompletionsPayload = {
    ...payload,
    // Explicitly preserve tools and tool_choice to ensure they're not lost
    ...(payload.tools && { tools: payload.tools }),
    ...(payload.tool_choice && { tool_choice: payload.tool_choice }),
  }

  // Call Copilot API and handle HTTP errors with detailed logging
  let response: Awaited<ReturnType<typeof createChatCompletions>>
  try {
    response = await createChatCompletions(finalPayload)
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
