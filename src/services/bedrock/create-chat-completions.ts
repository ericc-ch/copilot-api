import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConversationRole,
  type ConverseCommandInput,
  type ConverseStreamCommandInput,
  type Message as BedrockMessage,
} from "@aws-sdk/client-bedrock-runtime"
import consola from "consola"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  TextPart,
} from "~/services/copilot/create-chat-completions"

import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

/**
 * Create chat completions using AWS Bedrock
 */
export const createBedrockChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.awsRegion || !state.awsAccessKeyId || !state.awsSecretAccessKey) {
    throw new Error("AWS Bedrock credentials not configured")
  }

  const client = new BedrockRuntimeClient({
    region: state.awsRegion,
    credentials: {
      accessKeyId: state.awsAccessKeyId,
      secretAccessKey: state.awsSecretAccessKey,
      sessionToken: state.awsSessionToken,
    },
  })

  const bedrockInput = translateToBedrockFormat(payload)

  if (payload.stream) {
    return handleStreamingResponse(client, bedrockInput, payload.model)
  }

  return handleNonStreamingResponse(client, bedrockInput, payload.model)
}

/**
 * Translate OpenAI format to Bedrock Converse API format
 */
function translateToBedrockFormat(
  payload: ChatCompletionsPayload,
): ConverseCommandInput {
  // Extract system messages first
  const systemMessages = payload.messages
    .filter((msg) => msg.role === "system")
    .map((msg) => ({
      text: typeof msg.content === "string" ? msg.content : "",
    }))
    .filter((msg) => msg.text.trim())

  // Process non-system messages, filtering out empty content
  const filteredMessages: Array<BedrockMessage> = payload.messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      const content = translateMessageContent(msg.content)
      if (!content) return null

      return {
        role: (msg.role === "assistant" ?
          "assistant"
        : "user") as ConversationRole,
        content,
      }
    })
    .filter((msg): msg is BedrockMessage => msg !== null)

  const bedrockInput = {
    modelId: mapModelIdToBedrock(payload.model),
    messages: filteredMessages,
    system: systemMessages.length > 0 ? systemMessages : undefined,
    inferenceConfig: {
      // Ensure maxTokens is always set - default to 4096 if not specified
      maxTokens: payload.max_tokens ?? 4096,
      temperature: payload.temperature ?? undefined,
      topP: payload.top_p ?? undefined,
      stopSequences: formatStopSequences(payload.stop),
    },
  }

  consola.debug("Bedrock request config:", {
    modelId: bedrockInput.modelId,
    messageCount: bedrockInput.messages.length,
    systemMessageCount: bedrockInput.system?.length ?? 0,
    maxTokens: bedrockInput.inferenceConfig.maxTokens,
    temperature: bedrockInput.inferenceConfig.temperature,
    stopSequences: bedrockInput.inferenceConfig.stopSequences,
  })

  return bedrockInput
}

/**
 * Format stop sequences for Bedrock API
 */
function formatStopSequences(
  stop: string | Array<string> | null | undefined,
): Array<string> | undefined {
  if (!stop) return undefined
  return Array.isArray(stop) ? stop : [stop]
}

/**
 * Translate message content to Bedrock format
 * Returns null for empty content to allow filtering at message level
 */
function translateMessageContent(
  content: string | Array<ContentPart> | null,
): Array<{ text: string }> | null {
  if (typeof content === "string") {
    return content.trim() ? [{ text: content }] : null
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (part): part is TextPart =>
          part.type === "text" && Boolean(part.text.trim()),
      )
      .map((part) => ({ text: part.text }))

    return textParts.length > 0 ? textParts : null
  }

  return null
}

/**
 * Map model name to Bedrock global inference profile ID
 */
function mapModelIdToBedrock(model: string): string {
  // Use global inference profiles for Claude 4.5 models
  if (model.includes("sonnet")) {
    return "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
  }
  if (model.includes("haiku")) {
    return "global.anthropic.claude-haiku-4-5-20251001-v1:0"
  }

  // Default to Claude Sonnet 4.5 if unknown
  consola.warn(`Unknown model ${model}, defaulting to Claude Sonnet 4.5`)
  return "global.anthropic.claude-sonnet-4-5-20250929-v1:0"
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(
  client: BedrockRuntimeClient,
  input: ConverseCommandInput,
  originalModel: string,
): Promise<ChatCompletionResponse> {
  try {
    const command = new ConverseCommand(input)
    const response = await client.send(command)

    const content = response.output?.message?.content?.[0]?.text ?? ""
    const usage = response.usage

    return {
      id: `bedrock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: originalModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          logprobs: null,
          finish_reason: mapStopReason(response.stopReason),
        },
      ],
      usage: {
        prompt_tokens: usage?.inputTokens ?? 0,
        completion_tokens: usage?.outputTokens ?? 0,
        total_tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      },
    }
  } catch (error) {
    consola.error("Failed to create Bedrock chat completions", error)
    throw new HTTPError("Failed to create Bedrock chat completions", {
      status: 500,
      statusText: "Internal Server Error",
    } as Response)
  }
}

/**
 * Create a content chunk for streaming
 */
function createContentChunk(
  content: string,
  chunkIndex: number,
  model: string,
): ChatCompletionChunk {
  return {
    id: `bedrock-${Date.now()}-${chunkIndex}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
        logprobs: null,
      },
    ],
  }
}

/**
 * Create a final chunk with finish reason
 */
function createFinalChunk(
  chunkIndex: number,
  model: string,
  finishReason: string,
): ChatCompletionChunk {
  return {
    id: `bedrock-${Date.now()}-${chunkIndex}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  }
}

/**
 * Handle streaming response
 */
async function* handleStreamingResponse(
  client: BedrockRuntimeClient,
  input: ConverseStreamCommandInput,
  originalModel: string,
): AsyncGenerator<{ data: string; event?: string }> {
  try {
    const command = new ConverseStreamCommand(input)
    const response = await client.send(command)

    if (!response.stream) {
      throw new Error("No stream in response")
    }

    let chunkIndex = 0
    let hasMessageStop = false
    let streamError: Error | null = null

    consola.debug("Bedrock stream started")

    try {
      for await (const event of response.stream) {
        consola.debug("Bedrock stream event:", JSON.stringify(event))

        if (event.contentBlockDelta?.delta?.text) {
          const chunk = createContentChunk(
            event.contentBlockDelta.delta.text,
            chunkIndex,
            originalModel,
          )
          yield { event: "message", data: JSON.stringify(chunk) }
          chunkIndex++
        }

        if (event.messageStop) {
          hasMessageStop = true
          const finalChunk = createFinalChunk(
            chunkIndex,
            originalModel,
            mapStopReason(event.messageStop.stopReason),
          )
          yield { event: "message", data: JSON.stringify(finalChunk) }
        }
      }
    } catch (error) {
      consola.warn("Bedrock stream interrupted:", error)
      streamError = error as Error
    }

    consola.debug(
      "Bedrock stream completed, hasMessageStop:",
      hasMessageStop,
      "streamError:",
      streamError?.message,
    )

    // Always send final chunk and [DONE] after stream completes
    if (!hasMessageStop) {
      const finalChunk = createFinalChunk(chunkIndex, originalModel, "stop")
      yield { event: "message", data: JSON.stringify(finalChunk) }
    }

    consola.debug("Bedrock sending [DONE]")
    yield { data: "[DONE]" }
  } catch (error) {
    consola.error("Failed to stream Bedrock chat completions", error)
    throw new HTTPError("Failed to stream Bedrock chat completions", {
      status: 500,
      statusText: "Internal Server Error",
    } as Response)
  }
}

/**
 * Map Bedrock stop reason to OpenAI finish reason
 */
function mapStopReason(
  stopReason: string | undefined,
): "stop" | "length" | "tool_calls" | "content_filter" {
  if (!stopReason) return "stop"

  switch (stopReason) {
    case "end_turn": {
      return "stop"
    }
    case "max_tokens": {
      return "length"
    }
    case "stop_sequence": {
      return "stop"
    }
    case "tool_use": {
      return "tool_calls"
    }
    case "content_filtered": {
      return "content_filter"
    }
    default: {
      return "stop"
    }
  }
}
