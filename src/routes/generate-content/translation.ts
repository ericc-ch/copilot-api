import { DebugLogger } from "~/lib/debug-logger"
import {
  translateGeminiToolsToOpenAI,
  translateGeminiToolConfigToOpenAI,
  generateToolCallId,
  synthesizeToolsFromContents,
  ToolCallAccumulator,
  processToolCalls as processToolCallsWithAccumulator,
} from "~/lib/tool-call-utils"
import {
  type ChatCompletionResponse,
  type ChatCompletionChunk,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type Tool,
} from "~/services/copilot/create-chat-completions"

import {
  type GeminiRequest,
  type GeminiResponse,
  type GeminiContent,
  type GeminiPart,
  type GeminiTextPart,
  type GeminiFunctionCallPart,
  type GeminiFunctionResponsePart,
  type GeminiTool,
  type GeminiCandidate,
  type GeminiCountTokensRequest,
  type GeminiCountTokensResponse,
  type GeminiUsageMetadata,
} from "./types"
import { mapOpenAIFinishReasonToGemini } from "./utils"

// Model mapping for Gemini models - only map unsupported variants to supported ones
function mapGeminiModelToCopilot(geminiModel: string): string {
  const modelMap: Record<string, string> = {
    "gemini-2.5-flash": "gemini-2.0-flash-001", // Map to supported Gemini model
    "gemini-2.0-flash": "gemini-2.0-flash-001", // Map to full model name
    "gemini-2.5-flash-lite": "gemini-2.0-flash-001", // Map to full model name
  }

  return modelMap[geminiModel] || geminiModel // Return original if supported
}

function selectTools(
  geminiTools?: Array<GeminiTool>,
  contents?: Array<
    | GeminiContent
    | Array<{
        functionResponse: { id?: string; name: string; response: unknown }
      }>
  >,
): Array<Tool> | undefined {
  return (
    translateGeminiToolsToOpenAI(geminiTools)
    || (contents ? synthesizeToolsFromContents(contents) : undefined)
  )
}

// Request translation: Gemini -> OpenAI

export function translateGeminiToOpenAI(
  payload: GeminiRequest,
  model: string,
  stream: boolean,
): ChatCompletionsPayload {
  const tools = selectTools(payload.tools, payload.contents)
  const result = {
    model: mapGeminiModelToCopilot(model),
    messages: translateGeminiContentsToOpenAI(
      payload.contents,
      payload.systemInstruction,
    ),
    max_tokens: (payload.generationConfig?.maxOutputTokens as number) || 4096,
    stop: payload.generationConfig?.stopSequences as Array<string> | undefined,
    stream,
    temperature: payload.generationConfig?.temperature as number | undefined,
    top_p: payload.generationConfig?.topP as number | undefined,
    tools,
    tool_choice:
      tools ? translateGeminiToolConfigToOpenAI(payload.toolConfig) : undefined,
  }

  return result
}

// Helper function to match function name to tool call ID and emit tool response
function matchAndEmitToolResponse(options: {
  functionName: string
  functionResponse: unknown
  pendingToolCalls: Map<string, string>
  messages: Array<Message>
}): void {
  const { functionName, functionResponse, pendingToolCalls, messages } = options

  // Find tool call ID by searching through the map
  let matchedToolCallId: string | undefined
  for (const [toolCallId, mappedFunctionName] of pendingToolCalls.entries()) {
    if (mappedFunctionName === functionName) {
      matchedToolCallId = toolCallId
      break
    }
  }

  if (matchedToolCallId) {
    messages.push({
      role: "tool",
      tool_call_id: matchedToolCallId,
      content: JSON.stringify(functionResponse),
    })
    pendingToolCalls.delete(matchedToolCallId)
  }
}

// Helper function to process function response arrays
function processFunctionResponseArray(
  responseArray: Array<{
    functionResponse: { name: string; response: unknown }
  }>,
  pendingToolCalls: Map<string, string>,
  messages: Array<Message>,
): void {
  for (const responseItem of responseArray) {
    if ("functionResponse" in responseItem) {
      matchAndEmitToolResponse({
        functionName: responseItem.functionResponse.name,
        functionResponse: responseItem.functionResponse.response,
        pendingToolCalls,
        messages,
      })
    }
  }
}

// Helper function to process function responses in content
function processFunctionResponses(
  functionResponses: Array<GeminiFunctionResponsePart>,
  pendingToolCalls: Map<string, string>,
  messages: Array<Message>,
): void {
  for (const funcResponse of functionResponses) {
    matchAndEmitToolResponse({
      functionName: funcResponse.functionResponse.name,
      functionResponse: funcResponse.functionResponse.response,
      pendingToolCalls,
      messages,
    })
  }
}

// Helper function to process function calls and create assistant message
function processFunctionCalls(options: {
  functionCalls: Array<GeminiFunctionCallPart>
  content: GeminiContent
  pendingToolCalls: Map<string, string>
  messages: Array<Message>
}): void {
  const { functionCalls, content, pendingToolCalls, messages } = options

  const textContent = extractTextFromGeminiContent(content)
  const toolCalls = functionCalls.map((call) => {
    const toolCallId = generateToolCallId(call.functionCall.name)
    // Remember this tool call for later matching with responses
    // Use tool_call_id as key to avoid duplicate function name overwrites
    pendingToolCalls.set(toolCallId, call.functionCall.name)

    return {
      id: toolCallId,
      type: "function" as const,
      function: {
        name: call.functionCall.name,
        arguments: JSON.stringify(call.functionCall.args),
      },
    }
  })

  messages.push({
    role: "assistant",
    content: textContent || null,
    tool_calls: toolCalls,
  })
}

// Helper function to check if a tool response is duplicate
function isDuplicateToolResponse(
  message: Message,
  seenToolCallIds: Set<string>,
): boolean {
  return (
    message.role === "tool"
    && message.tool_call_id !== undefined
    && seenToolCallIds.has(message.tool_call_id)
  )
}

// Helper function to normalize user message content
function normalizeUserMessageContent(message: Message): void {
  if (
    message.role === "user"
    && typeof message.content === "string"
    && !message.content.trim()
  ) {
    message.content = " " // Add minimal text content as fallback
  }
}

// Helper function to check if messages can be merged
function canMergeMessages(
  lastMessage: Message,
  currentMessage: Message,
): boolean {
  return (
    lastMessage.role === currentMessage.role
    && !lastMessage.tool_calls
    && !currentMessage.tool_calls
    && !(lastMessage as { tool_call_id?: string }).tool_call_id
    && !(currentMessage as { tool_call_id?: string }).tool_call_id
    && typeof lastMessage.content === "string"
    && typeof currentMessage.content === "string"
  )
}

// Helper function to process and add message to cleaned array
function processAndAddMessage(
  message: Message,
  cleanedMessages: Array<Message>,
  seenToolCallIds: Set<string>,
): void {
  // Track tool call IDs for deduplication
  if (message.role === "tool" && message.tool_call_id) {
    seenToolCallIds.add(message.tool_call_id)
  }

  // Normalize user message content
  normalizeUserMessageContent(message)

  // Try to merge with previous message
  const lastMessage = cleanedMessages.at(-1)
  if (lastMessage && canMergeMessages(lastMessage, message)) {
    // Merge with previous message of same role
    // canMergeMessages already ensures both contents are strings
    if (
      typeof lastMessage.content === "string"
      && typeof message.content === "string"
    ) {
      lastMessage.content = `${lastMessage.content}\n\n${message.content}`
    }
  } else {
    cleanedMessages.push(message)
  }
}

// Consolidated message cleanup function
function cleanupMessages(messages: Array<Message>): Array<Message> {
  const cleanedMessages: Array<Message> = []
  const seenToolCallIds = new Set<string>()

  // Pre-build a set of all tool_call_ids that have tool responses (O(n))
  const toolCallIdsWithResponses = new Set<string>()
  for (const message of messages) {
    if (message.role === "tool" && message.tool_call_id) {
      toolCallIdsWithResponses.add(message.tool_call_id)
    }
  }

  for (const message of messages) {
    // Skip incomplete assistant messages with tool calls that have no responses
    if (message.role === "assistant" && message.tool_calls) {
      // Check if all tool calls have responses
      const hasAllResponses = message.tool_calls.every((call) =>
        toolCallIdsWithResponses.has(call.id),
      )
      if (!hasAllResponses) {
        continue
      }
    }

    // Skip duplicate tool responses
    if (isDuplicateToolResponse(message, seenToolCallIds)) {
      continue
    }

    processAndAddMessage(message, cleanedMessages, seenToolCallIds)
  }

  return cleanedMessages
}

/**
 * Translates Gemini conversation contents to OpenAI message format.
 *
 * This function handles complex transformations including:
 * - Converting Gemini "model" role to OpenAI "assistant" role
 * - Processing tool calls (function calls) and their responses
 * - Managing tool call ID mapping through pendingToolCalls Map
 * - Handling special nested array format for function responses (Gemini CLI compatibility)
 * - Cleaning up incomplete tool calls and deduplicating tool responses
 *
 * @remarks
 * The `pendingToolCalls` Map maintains the relationship between generated tool_call_ids
 * and function names throughout the conversation. This is necessary because:
 * - Gemini function calls don't have IDs, but OpenAI tool calls require them
 * - We generate IDs when translating function calls to tool calls
 * - Later function responses need to reference these IDs via tool_call_id
 *
 * Tool Call Matching Strategy:
 * - When a function call is encountered, generate a tool_call_id and store it in pendingToolCalls
 * - When a function response is encountered, look up the corresponding tool_call_id by function name
 * - After matching, remove the tool_call_id from pendingToolCalls to prevent duplicate matches
 *
 * Special Cases:
 * - Nested array format: Gemini CLI sometimes sends function responses as `Array<{functionResponse: ...}>`
 *   instead of inside GeminiContent.parts. We detect and handle this format separately.
 * - Incomplete tool calls: Assistant messages with tool calls that have no corresponding responses
 *   are filtered out during the cleanup phase to avoid OpenAI API errors.
 *
 * @param contents - Array of Gemini conversation contents (may include nested arrays for function responses)
 * @param systemInstruction - Optional system instruction to prepend to the conversation
 * @returns Array of OpenAI-compatible messages
 */
function translateGeminiContentsToOpenAI(
  contents: Array<
    | GeminiContent
    | Array<{
        functionResponse: { id?: string; name: string; response: unknown }
      }>
  >,
  systemInstruction?: GeminiContent,
): Array<Message> {
  const messages: Array<Message> = []
  const pendingToolCalls = new Map<string, string>() // tool_call_id -> function_name

  // Add system instruction first if present
  if (systemInstruction) {
    const systemText = extractTextFromGeminiContent(systemInstruction)
    if (systemText) {
      messages.push({ role: "system", content: systemText })
    }
  }

  // Process conversation contents
  for (const item of contents) {
    // Handle special case where Gemini CLI sends function responses as nested arrays
    if (Array.isArray(item)) {
      processFunctionResponseArray(item, pendingToolCalls, messages)
      continue
    }

    const content = item
    const role = content.role === "model" ? "assistant" : "user"

    // Check for function calls/responses
    const functionCalls = content.parts.filter(
      (part): part is GeminiFunctionCallPart => "functionCall" in part,
    )
    const functionResponses = content.parts.filter(
      (part): part is GeminiFunctionResponsePart => "functionResponse" in part,
    )

    if (functionResponses.length > 0) {
      processFunctionResponses(functionResponses, pendingToolCalls, messages)
    }

    if (functionCalls.length > 0 && role === "assistant") {
      processFunctionCalls({
        functionCalls,
        content,
        pendingToolCalls,
        messages,
      })
    } else {
      // Regular message
      const messageContent = translateGeminiContentToOpenAI(content)
      if (messageContent) {
        messages.push({ role, content: messageContent })
      }
    }
  }

  // Post-process: Clean up messages and ensure tool call consistency
  return cleanupMessages(messages)
}

function translateGeminiContentToOpenAI(
  content: GeminiContent,
): string | Array<ContentPart> | null {
  if (content.parts.length === 0) return null

  const hasMedia = content.parts.some((part) => "inlineData" in part)

  if (!hasMedia) {
    // Text-only content
    return extractTextFromGeminiContent(content)
  }

  // Mixed content with media
  const contentParts: Array<ContentPart> = []
  for (const part of content.parts) {
    if ("text" in part) {
      contentParts.push({ type: "text", text: part.text })
    } else if ("inlineData" in part) {
      // Handle inline data for images - this is a legacy format
      const partWithInlineData = part as {
        inlineData: { mimeType: string; data: string }
      }
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${partWithInlineData.inlineData.mimeType};base64,${partWithInlineData.inlineData.data}`,
        },
      })
    }
  }

  return contentParts
}

function extractTextFromGeminiContent(content: GeminiContent): string {
  return content.parts
    .filter((part): part is GeminiTextPart => "text" in part)
    .map((part) => part.text)
    .join("\n\n")
}

// Response translation: OpenAI -> Gemini

// Helper function to deduplicate tool responses - remove duplicate tool_call_ids
// The problem was our logic was CREATING duplicates instead of preventing them

export function translateOpenAIToGemini(
  response: ChatCompletionResponse,
): GeminiResponse {
  const result = {
    candidates: response.choices.map((choice, index) => ({
      content: translateOpenAIMessageToGeminiContent(choice.message),
      finishReason: mapOpenAIFinishReasonToGemini(choice.finish_reason),
      index,
    })),
    usageMetadata: {
      promptTokenCount: response.usage?.prompt_tokens || 0,
      candidatesTokenCount: response.usage?.completion_tokens || 0,
      totalTokenCount: response.usage?.total_tokens || 0,
    },
  }

  // Debug: Log original GitHub Copilot response and translated Gemini response
  if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
    DebugLogger.logResponseComparison(response, result, {
      context: "Non-Stream Response Translation",
      filePrefix: "debug-nonstream-comparison",
    }).catch((error: unknown) => {
      console.error(
        "[DEBUG] Failed to log non-stream response comparison:",
        error,
      )
    })
  }

  return result
}

function translateOpenAIMessageToGeminiContent(
  message: Message,
): GeminiContent {
  const parts: Array<GeminiPart> = []

  // Handle text content
  if (typeof message.content === "string") {
    if (message.content) {
      parts.push({ text: message.content })
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        parts.push({ text: part.text })
      } else {
        // Convert data URL back to inline data
        const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          })
        }
      }
    }
  }

  // Handle tool calls
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      // Debug: Log tool call arguments to verify what GitHub Copilot returns
      if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
        console.log(
          `[DEBUG] Tool call - name: ${toolCall.function.name}, arguments: "${toolCall.function.arguments}", type: ${typeof toolCall.function.arguments}, truthy: ${Boolean(toolCall.function.arguments)}`,
        )
      }

      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args: (() => {
            if (toolCall.function.arguments) {
              try {
                return JSON.parse(toolCall.function.arguments) as Record<
                  string,
                  unknown
                >
              } catch (error) {
                if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
                  console.warn(
                    `[DEBUG] Failed to parse toolCall.function.arguments: "${toolCall.function.arguments}". Error:`,
                    error,
                  )
                }
                return {}
              }
            }
            return {}
          })(),
        },
      })
    }
  }

  return {
    parts,
    role: "model",
  }
}

// Utility functions

// Helper function to create usage metadata
function createUsageMetadata(chunk: ChatCompletionChunk): GeminiUsageMetadata {
  return {
    promptTokenCount: chunk.usage?.prompt_tokens || 0,
    candidatesTokenCount: chunk.usage?.completion_tokens || 0,
    totalTokenCount: chunk.usage?.total_tokens || 0,
  }
}

// Helper function to process chunk parts
function processChunkParts(
  choice: {
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: "function"
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  },
  accumulator: ToolCallAccumulator,
): Array<GeminiPart> {
  const parts: Array<GeminiPart> = []

  if (choice.delta.content) {
    parts.push({ text: choice.delta.content })
  }

  if (choice.delta.tool_calls) {
    parts.push(
      ...processToolCallsWithAccumulator(choice.delta.tool_calls, accumulator),
    )
  }

  return parts
}

// Helper function to determine finish reason inclusion
function shouldIncludeFinishReason(choice: {
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  delta: {
    tool_calls?: Array<unknown>
  }
}): boolean {
  // Always include finish_reason when present, regardless of tool calls
  // This ensures proper stream termination for both text and tool call completions
  return Boolean(choice.finish_reason)
}

// Helper function to create candidate object
function createGeminiCandidate(
  parts: Array<GeminiPart>,
  mappedFinishReason: string | undefined,
  index: number,
): GeminiCandidate {
  return {
    content: {
      parts,
      role: "model",
    },
    finishReason: mappedFinishReason as GeminiCandidate["finishReason"],
    index,
  }
}

// Helper function to handle parts processing and validation
function processParts(
  choice: {
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: "function"
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  },
  accumulator: ToolCallAccumulator,
): Array<GeminiPart> | null {
  const parts = processChunkParts(choice, accumulator)

  if (parts.length === 0 && !choice.finish_reason) {
    return null
  }

  // If we have a finish reason but no parts, add an empty text part
  // This ensures Gemini CLI receives a properly formatted completion chunk
  if (parts.length === 0 && choice.finish_reason) {
    parts.push({ text: "" })
  }

  return parts
}

// Helper function to build complete response
function buildGeminiResponse(
  candidate: GeminiCandidate,
  shouldInclude: boolean,
  chunk: ChatCompletionChunk,
): {
  candidates: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
} {
  const response: {
    candidates: Array<GeminiCandidate>
    usageMetadata?: GeminiUsageMetadata
  } = {
    candidates: [candidate],
  }

  if (shouldInclude) {
    response.usageMetadata = createUsageMetadata(chunk)
  }

  return response
}

// Stream translation: OpenAI Chunk -> Gemini Stream Response
export function translateOpenAIChunkToGemini(
  chunk: ChatCompletionChunk,
  accumulator: ToolCallAccumulator,
): {
  candidates: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
} | null {
  if (chunk.choices.length === 0) {
    return null
  }

  const choice = chunk.choices[0]

  const parts = processParts(choice, accumulator)
  if (!parts) {
    return null
  }

  // Additional validation - if we only have function call parts with empty names,
  // skip this chunk entirely to prevent invalid tool call responses
  const hasOnlyEmptyToolCalls =
    parts.length > 0
    && parts.every((part) => {
      if ("functionCall" in part) {
        return !part.functionCall.name || part.functionCall.name.trim() === ""
      }
      return false
    })
    && parts.some((part) => "functionCall" in part)

  if (hasOnlyEmptyToolCalls && !choice.finish_reason) {
    return null
  }

  const shouldInclude = shouldIncludeFinishReason(choice)
  const mappedFinishReason =
    shouldInclude ?
      mapOpenAIFinishReasonToGemini(choice.finish_reason)
    : undefined

  const candidate = createGeminiCandidate(
    parts,
    mappedFinishReason,
    choice.index,
  )
  const response = buildGeminiResponse(candidate, shouldInclude, chunk)

  // Debug: Log original GitHub Copilot chunk and translated Gemini chunk for comparison
  if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
    DebugLogger.logResponseComparison(chunk, response, {
      context: "Streaming Chunk Translation",
      filePrefix: "debug-stream-comparison",
    }).catch((error: unknown) => {
      console.error("[DEBUG] Failed to log streaming chunk comparison:", error)
    })
  }

  return response
}

// Token counting translation

export function translateGeminiCountTokensToOpenAI(
  request: GeminiCountTokensRequest,
  model: string,
): ChatCompletionsPayload {
  const tools = selectTools(request.tools, request.contents)
  return {
    model: mapGeminiModelToCopilot(model),
    messages: translateGeminiContentsToOpenAI(
      request.contents,
      request.systemInstruction,
    ),
    max_tokens: 1,
    tools,
  }
}

export function translateTokenCountToGemini(
  totalTokens: number,
): GeminiCountTokensResponse {
  return {
    totalTokens,
  }
}
