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
} from "./gemini-types"

// Request translation: Gemini -> OpenAI

export function translateGeminiToOpenAINonStream(
  payload: GeminiRequest,
  model: string,
): ChatCompletionsPayload {
  return {
    model, // Always use the model from the URL
    messages: translateGeminiContentsToOpenAI(
      payload.contents,
      payload.systemInstruction,
    ),
    max_tokens: payload.generationConfig?.maxOutputTokens || 4096,
    stop: payload.generationConfig?.stopSequences,
    stream: false,
    temperature: payload.generationConfig?.temperature,
    top_p: payload.generationConfig?.topP,
    tools: translateGeminiToolsToOpenAI(payload.tools),
    tool_choice: translateGeminiToolConfigToOpenAI(payload.toolConfig),
  }
}

export function translateGeminiToOpenAIStream(
  payload: GeminiRequest,
  model: string,
): ChatCompletionsPayload {
  const result = {
    model, // Always use the model from the URL
    messages: translateGeminiContentsToOpenAI(
      payload.contents,
      payload.systemInstruction,
    ),
    max_tokens: payload.generationConfig?.maxOutputTokens || 4096,
    stop: payload.generationConfig?.stopSequences,
    stream: true,
    temperature: payload.generationConfig?.temperature,
    top_p: payload.generationConfig?.topP,
    tools: translateGeminiToolsToOpenAI(payload.tools),
    tool_choice: translateGeminiToolConfigToOpenAI(payload.toolConfig),
  }

  return result
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
      const functionName = responseItem.functionResponse.name
      const toolCallId = pendingToolCalls.get(functionName)
      if (toolCallId) {
        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(responseItem.functionResponse.response),
        })
        pendingToolCalls.delete(functionName)
      }
    }
  }
}

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
  const pendingToolCalls = new Map<string, string>() // function name -> tool_call_id

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
      // Add tool result messages
      for (const funcResponse of functionResponses) {
        const functionName = funcResponse.functionResponse.name
        const toolCallId = pendingToolCalls.get(functionName)
        if (toolCallId) {
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify(funcResponse.functionResponse.response),
          })
          pendingToolCalls.delete(functionName)
        }
      }
    }

    if (functionCalls.length > 0 && role === "assistant") {
      // Assistant message with tool calls
      const textContent = extractTextFromGeminiContent(content)
      const toolCalls = functionCalls.map((call) => {
        const toolCallId = generateToolCallId(call.functionCall.name)
        // Remember this tool call for later matching with responses
        pendingToolCalls.set(call.functionCall.name, toolCallId)
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
    } else {
      // Regular message
      const messageContent = translateGeminiContentToOpenAI(content)
      if (messageContent) {
        messages.push({ role, content: messageContent })
      }
    }
  }

  return messages
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
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
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

function translateGeminiToolsToOpenAI(
  geminiTools?: Array<GeminiTool>,
): Array<Tool> | undefined {
  if (!geminiTools || geminiTools.length === 0) return undefined

  const tools: Array<Tool> = []
  for (const tool of geminiTools) {
    for (const func of tool.functionDeclarations) {
      tools.push({
        type: "function",
        function: {
          name: func.name,
          description: func.description,
          parameters: func.parametersJsonSchema || func.parameters,
        },
      })
    }
  }

  return tools
}

function translateGeminiToolConfigToOpenAI(
  toolConfig?: GeminiRequest["toolConfig"],
): ChatCompletionsPayload["tool_choice"] {
  if (!toolConfig) return undefined

  const mode = toolConfig.functionCallingConfig.mode
  switch (mode) {
    case "AUTO": {
      return "auto"
    }
    case "ANY": {
      return "required"
    }
    case "NONE": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// Response translation: OpenAI -> Gemini

export function translateOpenAIToGemini(
  response: ChatCompletionResponse,
): GeminiResponse {
  const candidates: Array<GeminiCandidate> = response.choices.map(
    (choice, index) => ({
      content: translateOpenAIMessageToGeminiContent(choice.message),
      finishReason: mapOpenAIFinishReasonToGemini(choice.finish_reason),
      index,
    }),
  )

  return {
    candidates,
    usageMetadata: {
      promptTokenCount: response.usage?.prompt_tokens || 0,
      candidatesTokenCount: response.usage?.completion_tokens || 0,
      totalTokenCount: response.usage?.total_tokens || 0,
    },
  }
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
      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args:
            toolCall.function.arguments ?
              (JSON.parse(toolCall.function.arguments) as Record<
                string,
                unknown
              >)
            : {},
        },
      })
    }
  }

  return {
    parts,
    role: "model",
  }
}

function mapOpenAIFinishReasonToGemini(
  finishReason: string | null,
): GeminiCandidate["finishReason"] {
  switch (finishReason) {
    case "stop": {
      return "STOP"
    }
    case "length": {
      return "MAX_TOKENS"
    }
    case "content_filter": {
      return "SAFETY"
    }
    case "tool_calls": {
      return "STOP"
    } // Gemini doesn't have a specific tool_calls finish reason
    default: {
      return "FINISH_REASON_UNSPECIFIED"
    }
  }
}

// Utility functions

function generateToolCallId(functionName: string): string {
  return `call_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// Helper function to process tool calls in streaming chunks
function processToolCalls(
  toolCalls: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>,
): Array<GeminiPart> {
  const parts: Array<GeminiPart> = []

  for (const toolCall of toolCalls) {
    if (!toolCall.function?.name) {
      continue
    }

    let args: Record<string, unknown>
    try {
      args = JSON.parse(toolCall.function.arguments || "{}") as Record<
        string,
        unknown
      >
    } catch {
      // In streaming, arguments might be incomplete JSON
      // Skip this chunk and wait for complete arguments
      continue
    }

    parts.push({
      functionCall: {
        name: toolCall.function.name,
        args,
      },
    })
  }

  return parts
}

// Helper function to create usage metadata
function createUsageMetadata(chunk: ChatCompletionChunk): GeminiUsageMetadata {
  return {
    promptTokenCount: chunk.usage?.prompt_tokens || 0,
    candidatesTokenCount: chunk.usage?.completion_tokens || 0,
    totalTokenCount: chunk.usage?.total_tokens || 0,
  }
}

// Stream translation: OpenAI Chunk -> Gemini Stream Response
export function translateOpenAIChunkToGemini(chunk: ChatCompletionChunk): {
  candidates: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
} | null {
  if (chunk.choices.length === 0) {
    return null
  }

  const choice = chunk.choices[0]
  const parts: Array<GeminiPart> = []

  if (choice.delta.content) {
    parts.push({ text: choice.delta.content })
  }

  if (choice.delta.tool_calls) {
    parts.push(...processToolCalls(choice.delta.tool_calls))
  }

  if (parts.length === 0 && !choice.finish_reason) {
    return null
  }

  const candidate: GeminiCandidate = {
    content: {
      parts,
      role: "model",
    },
    finishReason: mapOpenAIFinishReasonToGemini(choice.finish_reason),
    index: choice.index,
  }

  const response: {
    candidates: Array<GeminiCandidate>
    usageMetadata?: GeminiUsageMetadata
  } = {
    candidates: [candidate],
  }

  if (choice.finish_reason) {
    response.usageMetadata = createUsageMetadata(chunk)
  }

  return response
}

// Token counting translation

export function translateGeminiCountTokensToOpenAI(
  request: GeminiCountTokensRequest,
  model: string,
): ChatCompletionsPayload {
  return {
    model,
    messages: translateGeminiContentsToOpenAI(
      request.contents,
      request.systemInstruction,
    ),
    max_tokens: 1, // Minimal for token counting
    tools: translateGeminiToolsToOpenAI(request.tools),
  }
}

export function translateTokenCountToGemini(
  totalTokens: number,
): GeminiCountTokensResponse {
  return {
    totalTokens,
  }
}
