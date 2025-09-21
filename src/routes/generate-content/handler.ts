import type { Context } from "hono"
import type { SSEStreamingApi } from "hono/streaming"

import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
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

import {
  translateGeminiToOpenAINonStream,
  translateGeminiToOpenAIStream,
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

// Standard generation endpoint
export async function handleGeminiGeneration(c: Context) {
  const model = extractModelFromUrl(c.req.url)

  if (!model) {
    throw new Error("Model name is required in URL path")
  }

  await checkRateLimit(state)

  const geminiPayload = await c.req.json<GeminiRequest>()

  const openAIPayload = translateGeminiToOpenAINonStream(geminiPayload, model)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    const geminiResponse = translateOpenAIToGemini(response)

    return c.json(geminiResponse)
  }

  // This shouldn't happen for non-streaming endpoint
  throw new Error("Unexpected streaming response for non-streaming endpoint")
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

// Accumulative JSON parser for handling incomplete chunks (based on LiteLLM research)
class StreamingJSONParser {
  private accumulatedData = ""
  private parseMode: "direct" | "accumulated" = "direct"

  parseChunk(rawData: string): unknown {
    if (this.parseMode === "direct") {
      try {
        return JSON.parse(rawData)
      } catch {
        // Switch to accumulated mode on first failure (LiteLLM pattern)
        this.parseMode = "accumulated"
        this.accumulatedData = rawData
        return null
      }
    } else {
      // Accumulated mode - keep building until valid JSON
      this.accumulatedData += rawData
      try {
        const result = JSON.parse(this.accumulatedData) as unknown
        // Success - reset for next chunk
        this.accumulatedData = ""
        this.parseMode = "direct" // Can switch back to direct mode
        return result
      } catch {
        // Continue accumulating
        return null
      }
    }
  }
}

// Global parser instance for the stream
// let streamParser = new StreamingJSONParser()

// Helper function to process chunk and write to stream
async function processAndWriteChunk(params: {
  rawEvent: { data?: string }
  stream: SSEStreamingApi
  lastWritePromise: Promise<void>
  streamParser: StreamingJSONParser
}): Promise<{ newWritePromise: Promise<void>; hasFinishReason: boolean }> {
  const { rawEvent, stream, lastWritePromise, streamParser } = params

  if (!rawEvent.data) {
    return { newWritePromise: lastWritePromise, hasFinishReason: false }
  }

  try {
    const chunk = streamParser.parseChunk(rawEvent.data)

    // If parser returns null, we're still accumulating
    if (!chunk) {
      return { newWritePromise: lastWritePromise, hasFinishReason: false }
    }

    const geminiChunk = translateOpenAIChunkToGemini(
      chunk as ChatCompletionChunk,
    )

    if (geminiChunk) {
      // Check if this chunk contains a finish reason
      const chunkHasFinishReason = geminiChunk.candidates.some(
        (c) => c.finishReason && c.finishReason !== "FINISH_REASON_UNSPECIFIED",
      )

      // Wait for previous write to complete before writing new chunk
      await lastWritePromise
      const newWritePromise = stream.writeSSE({
        data: JSON.stringify(geminiChunk),
      })

      return { newWritePromise, hasFinishReason: chunkHasFinishReason }
    } else {
      return { newWritePromise: lastWritePromise, hasFinishReason: false }
    }
  } catch (parseError) {
    console.error("[GEMINI_STREAM] Error parsing chunk", parseError)
    return { newWritePromise: lastWritePromise, hasFinishReason: false }
  }
}

// Helper function to handle streaming response processing
function handleStreamingResponse(
  c: Context,
  response: AsyncIterable<{ data?: string }>,
) {
  return streamSSE(c, async (stream) => {
    // Create a parser instance for this stream (each request gets its own parser)
    const streamParser = new StreamingJSONParser()
    let lastWritePromise: Promise<void> = Promise.resolve()

    try {
      for await (const rawEvent of response) {
        if (rawEvent.data === "[DONE]") {
          break
        }

        const result = await processAndWriteChunk({
          rawEvent,
          stream,
          lastWritePromise,
          streamParser,
        })
        lastWritePromise = result.newWritePromise
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

// Streaming generation endpoint
export async function handleGeminiStreamGeneration(c: Context) {
  const model = extractModelFromUrl(c.req.url)

  if (!model) {
    throw new Error("Model name is required in URL path")
  }

  await checkRateLimit(state)

  const geminiPayload = await c.req.json<GeminiRequest>()

  const openAIPayload = translateGeminiToOpenAIStream(geminiPayload, model)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    const geminiResponse = translateOpenAIToGemini(response)

    return handleNonStreamingToStreaming(c, geminiResponse)
  }

  return handleStreamingResponse(c, response)
}

// Token counting endpoint
export async function handleGeminiCountTokens(c: Context) {
  const model = extractModelFromUrl(c.req.url)

  if (!model) {
    throw new Error("Model name is required in URL path")
  }

  const geminiPayload = await c.req.json<GeminiCountTokensRequest>()

  const openAIPayload = translateGeminiCountTokensToOpenAI(geminiPayload, model)

  const tokenCounts = getTokenCount(openAIPayload.messages)

  const totalTokens = tokenCounts.input + tokenCounts.output
  const geminiResponse = translateTokenCountToGemini(totalTokens)

  return c.json(geminiResponse)
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => "choices" in response
