import type { Context } from "hono"
import type { SSEStreamingApi } from "hono/streaming"

import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { DebugLogger } from "~/lib/debug-logger"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

// Helper function to extract model from URL path
function extractModelFromUrl(url: string): string {
  const match = url.match(/\/v1beta\/models\/([^:]+):/)
  if (!match) {
    throw new Error("Model name is required in URL path")
  }
  return match[1]
}

import { ToolCallAccumulator } from "~/lib/tool-call-utils"

import {
  translateGeminiToOpenAI,
  translateOpenAIToGemini,
  translateGeminiCountTokensToOpenAI,
  translateTokenCountToGemini,
  translateOpenAIChunkToGemini,
} from "./translation"
import {
  type GeminiRequest,
  type GeminiCountTokensRequest,
  type GeminiStreamResponse,
  type GeminiResponse,
} from "./types"

// Unified generation handler following Claude's two-branch pattern
export async function handleGeminiGeneration(
  c: Context,
  stream: boolean = false,
) {
  const model = extractModelFromUrl(c.req.url)

  if (!model) {
    throw new Error("Model name is required in URL path")
  }

  await checkRateLimit(state)

  const geminiPayload = await c.req.json<GeminiRequest>()
  const openAIPayload = translateGeminiToOpenAI(geminiPayload, model, stream)

  // Log request for debugging (async, non-blocking) - only if debug logging is enabled
  if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
    DebugLogger.logGeminiRequest(geminiPayload, openAIPayload).catch(
      (error: unknown) => {
        console.error("[DEBUG] Failed to log request:", error)
      },
    )
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    const geminiResponse = translateOpenAIToGemini(response)

    if (stream) {
      return handleNonStreamingToStreaming(c, geminiResponse)
    }
    return c.json(geminiResponse)
  }

  if (!stream) {
    throw new Error("Unexpected streaming response for non-streaming endpoint")
  }

  return handleStreamingResponse(c, response)
}

// Helper function to handle non-streaming response conversion
function handleNonStreamingToStreaming(
  c: Context,
  geminiResponse: GeminiResponse,
) {
  return streamSSE(c, async (stream) => {
    try {
      const firstPart = geminiResponse.candidates[0]?.content?.parts?.[0]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const hasTextContent = firstPart && "text" in firstPart

      // eslint-disable-next-line unicorn/prefer-ternary
      if (hasTextContent) {
        await sendTextInChunks(stream, firstPart.text, geminiResponse)
      } else {
        await sendFallbackResponse(stream, geminiResponse)
      }

      // Add a small delay to ensure all data is flushed
      await new Promise((resolve) => setTimeout(resolve, 50))
    } catch (error) {
      console.error("[GEMINI_STREAM] Error in non-streaming conversion", error)
    } finally {
      try {
        await stream.close()
      } catch (closeError) {
        console.error(
          "[GEMINI_STREAM] Error closing non-streaming conversion stream",
          closeError,
        )
      }
    }
  })
}

// Helper function to send text in chunks with configuration object
async function sendTextInChunks(
  stream: SSEStreamingApi,
  text: string,
  geminiResponse: GeminiResponse,
) {
  const chunkSize = Math.max(1, Math.min(50, text.length))
  let lastWritePromise: Promise<void> = Promise.resolve()

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    const isLast = i + chunkSize >= text.length
    const streamResponse: GeminiStreamResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: chunk }],
            role: "model",
          },
          finishReason:
            isLast ? geminiResponse.candidates[0]?.finishReason : undefined,
          index: 0,
        },
      ],
      ...(isLast && geminiResponse.usageMetadata ?
        { usageMetadata: geminiResponse.usageMetadata }
      : {}),
    }

    // Wait for previous write to complete before writing new chunk
    await lastWritePromise
    lastWritePromise = stream.writeSSE({
      data: JSON.stringify(streamResponse),
    })
  }

  // Wait for final write to complete
  await lastWritePromise
}

// Helper function to send fallback response
async function sendFallbackResponse(
  stream: SSEStreamingApi,
  geminiResponse: GeminiResponse,
) {
  const streamResponse: GeminiStreamResponse = {
    candidates: geminiResponse.candidates,
    usageMetadata: geminiResponse.usageMetadata,
  }

  await stream.writeSSE({ data: JSON.stringify(streamResponse) })
}

// Simplified Gemini streaming state (inspired by Claude AnthropicStreamState)
interface GeminiStreamState {
  jsonAccumulator: string
  parseMode: "direct" | "accumulated"
}

// Minimal state machine for JSON parsing only
class GeminiStreamParser {
  private state: GeminiStreamState = {
    jsonAccumulator: "",
    parseMode: "direct",
  }

  parseChunk(rawData: string): unknown {
    if (this.state.parseMode === "direct") {
      try {
        return JSON.parse(rawData)
      } catch {
        // Switch to accumulated mode on first failure
        this.state.parseMode = "accumulated"
        this.state.jsonAccumulator = rawData
        return null
      }
    } else {
      // Accumulated mode - keep building until valid JSON
      this.state.jsonAccumulator += rawData
      try {
        const result = JSON.parse(this.state.jsonAccumulator) as unknown
        // Success - reset for next chunk
        this.resetAccumulator()
        return result
      } catch {
        // Continue accumulating
        return null
      }
    }
  }

  private resetAccumulator(): void {
    this.state.jsonAccumulator = ""
    this.state.parseMode = "direct"
  }
}

// Helper function to handle streaming response processing
function handleStreamingResponse(
  c: Context,
  response: AsyncIterable<{ data?: string }>,
) {
  return streamSSE(c, async (stream) => {
    // Create a parser instance for this stream (each request gets its own parser)
    const streamParser = new GeminiStreamParser()
    // Create a tool call accumulator for this stream
    const toolCallAccumulator = new ToolCallAccumulator()
    let lastWritePromise: Promise<void> = Promise.resolve()

    try {
      for await (const rawEvent of response) {
        if (rawEvent.data === "[DONE]") {
          break
        }

        // Inline processing without extra wrapper
        if (!rawEvent.data) {
          continue
        }

        try {
          const chunk = streamParser.parseChunk(rawEvent.data)
          if (!chunk) {
            continue
          }

          const geminiChunk = translateOpenAIChunkToGemini(
            chunk as ChatCompletionChunk,
            toolCallAccumulator,
          )
          if (geminiChunk) {
            // Wait for previous write to complete before writing new chunk
            await lastWritePromise
            lastWritePromise = stream.writeSSE({
              data: JSON.stringify(geminiChunk),
            })
          }
        } catch (parseError) {
          console.error("[GEMINI_STREAM] Error parsing chunk", parseError)
          continue
        }
      }

      // Wait for all writes to complete before closing
      await lastWritePromise

      // Add a small delay to ensure all data is flushed
      await new Promise((resolve) => setTimeout(resolve, 50))
    } catch (error) {
      console.error("[GEMINI_STREAM] Error in streaming processing", error)
      // Ensure we don't leave the stream hanging
    } finally {
      // Always close the stream, but with proper cleanup
      try {
        await stream.close()
      } catch (closeError) {
        console.error("[GEMINI_STREAM] Error closing stream", closeError)
      }
    }
  })
}

// Create convenience wrapper for streaming generation
export function handleGeminiStreamGeneration(c: Context) {
  return handleGeminiGeneration(c, true)
}

// Token counting endpoint
export async function handleGeminiCountTokens(c: Context) {
  const model = extractModelFromUrl(c.req.url)

  if (!model) {
    throw new Error("Model name is required in URL path")
  }

  const geminiPayload = await c.req.json<GeminiCountTokensRequest>()

  const openAIPayload = translateGeminiCountTokensToOpenAI(geminiPayload, model)

  // Find the full Model object from state
  const selectedModel = state.models?.data.find((m) => m.id === model)

  if (!selectedModel) {
    // Fallback: return minimal token count if model not found
    const geminiResponse = translateTokenCountToGemini(10)
    return c.json(geminiResponse)
  }

  const tokenCounts = await getTokenCount(openAIPayload, selectedModel)

  const totalTokens = tokenCounts.input + tokenCounts.output
  const geminiResponse = translateTokenCountToGemini(totalTokens)

  return c.json(geminiResponse)
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => "choices" in response
