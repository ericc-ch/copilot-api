import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
  hasWebSearchTool,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  const webSearchEnabled = hasWebSearchTool(anthropicPayload.tools)

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  // When web search is enabled and non-streaming, check if the model wants
  // to search. If so, perform a proxy web search via a separate Copilot
  // request and inject results as a simulated server_tool_use / result.
  if (webSearchEnabled && !anthropicPayload.stream) {
    const webSearchResult = await maybePerformWebSearch(
      anthropicPayload,
      openAIPayload,
    )
    if (webSearchResult) {
      return c.json(webSearchResult)
    }
  }

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
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

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
  })
}

/**
 * When web search is enabled, first ask the model (non-streaming) if it needs
 * to search. If the response looks like a search intent, perform a proxy
 * search via a separate Copilot chat/completions call to a web-capable model
 * (gpt-4o) and return a synthetic Anthropic response containing both the
 * server_tool_use and web_search_tool_result blocks.
 */
async function maybePerformWebSearch(
  anthropicPayload: AnthropicMessagesPayload,
  openAIPayload: ReturnType<typeof translateToOpenAI>,
): Promise<AnthropicResponse | null> {
  // Skip if the conversation already contains a server_tool_result
  // (meaning we already searched and should let the model answer)
  const lastMsg =
    anthropicPayload.messages[anthropicPayload.messages.length - 1]
  if (
    lastMsg?.role === "user" &&
    Array.isArray(lastMsg.content) &&
    lastMsg.content.some(
      (b: { type: string }) =>
        b.type === "server_tool_result" ||
        b.type === "web_search_tool_result",
    )
  ) {
    return null
  }

  // Check if the previous assistant message already had a search request
  const prevMsg =
    anthropicPayload.messages.length >= 2
      ? anthropicPayload.messages[anthropicPayload.messages.length - 2]
      : null
  if (
    prevMsg?.role === "assistant" &&
    Array.isArray(prevMsg.content) &&
    prevMsg.content.some(
      (b: { type: string }) =>
        b.type === "server_tool_use" || b.type === "web_search_tool_use",
    )
  ) {
    return null
  }

  // Make the normal completion request first
  const response = await createChatCompletions({
    ...openAIPayload,
    stream: false,
  })

  if (!isNonStreaming(response)) {
    return null
  }

  // Check if the assistant response suggests it wants to search
  const assistantText = response.choices[0]?.message?.content ?? ""
  const searchQuery = extractSearchIntent(assistantText)

  if (!searchQuery) {
    // No search intent — return the translated response as-is
    return translateToAnthropic(response)
  }

  consola.info(`Web search proxy: searching for "${searchQuery}"`)

  // Perform the web search via a separate gpt-4o request
  const searchResults = await performWebSearch(searchQuery)

  if (!searchResults) {
    return translateToAnthropic(response)
  }

  // Build a synthetic Anthropic response with web search blocks
  const toolUseId = `ws_${Date.now()}`
  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content: [
      {
        type: "server_tool_use" as const,
        id: toolUseId,
        name: "web_search",
        input: { query: searchQuery },
      } as unknown as import("./anthropic-types").AnthropicAssistantContentBlock,
      {
        type: "web_search_tool_result" as const,
        tool_use_id: toolUseId,
        content: [
          {
            type: "web_search_result" as const,
            url: "",
            title: "Search Results",
            page_content: searchResults,
          },
        ],
      } as unknown as import("./anthropic-types").AnthropicAssistantContentBlock,
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  }
}

function extractSearchIntent(text: string): string | null {
  // Look for common patterns indicating the model wants to search
  const patterns = [
    /(?:let me|I'll|I will|I need to|I should|I want to)\s+(?:search|look up|find|check|google)/i,
    /(?:searching|looking up|searching for)[:\s]+["']?(.+?)["']?$/im,
    /\bsearch(?:ing)?\s+(?:for|the web|online)[:\s]+["']?(.+?)["']?$/im,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1] ?? text.trim().slice(0, 200)
    }
  }

  // If the text is short and looks like a search query itself
  if (text.length < 100 && text.includes("?")) {
    return text.trim()
  }

  return null
}

async function performWebSearch(query: string): Promise<string | null> {
  try {
    const searchPayload = {
      model: "gpt-4o",
      messages: [
        {
          role: "user" as const,
          content: `Search the web for: ${query}\n\nProvide a concise summary of the most relevant and recent results.`,
        },
      ],
      max_tokens: 1000,
      stream: false,
    }

    const searchResponse = await createChatCompletions(searchPayload)
    if (isNonStreaming(searchResponse)) {
      return searchResponse.choices[0]?.message?.content ?? null
    }
    return null
  } catch (error) {
    consola.warn("Web search proxy failed:", error)
    return null
  }
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
