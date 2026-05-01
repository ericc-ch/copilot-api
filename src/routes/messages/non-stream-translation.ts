import consola from "consola"

import { isClaudeOpus47Model, resolveModelId } from "~/lib/models"
import {
  sanitizeReasoningEffortForModel,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type TextPart,
  type Tool,
  type ToolCall,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicAssistantContentBlock,
  type AnthropicAssistantMessage,
  type AnthropicMessage,
  type AnthropicMessagesPayload,
  type AnthropicResponse,
  type AnthropicTextBlock,
  type AnthropicThinkingBlock,
  type AnthropicTool,
  type AnthropicToolResultBlock,
  type AnthropicToolUseBlock,
  type AnthropicUserContentBlock,
  type AnthropicUserMessage,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

// Payload translation

export function translateToOpenAI(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload {
  return {
    model: translateModelName(payload.model),
    messages: translateAnthropicMessagesToOpenAI(
      payload.messages,
      payload.system,
    ),
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    thinking: translateThinking(payload),
    output_config: translateOutputConfig(payload),
    reasoning_effort: translateReasoningEffort(payload),
    user: payload.metadata?.user_id,
    tools: translateAnthropicToolsToOpenAI(payload.tools),
    tool_choice: translateAnthropicToolChoiceToOpenAI(payload.tool_choice),
  }
}

function isClaudeModel(modelId: string): boolean {
  return modelId.startsWith("claude-")
}

type ClaudeOpus47Effort = NonNullable<
  NonNullable<ChatCompletionsPayload["output_config"]>["effort"]
>

// Per-model effort caps. Upstream rejects efforts above the model's tier.
// TODO: keep in sync with the mirror in services/copilot/create-chat-completions.ts.
// 2026-04 probe: upstream now accepts low/medium/high/xhigh/max for opus-4.7
// (and silently ignores unknown values), so the cap is opened up. Keep the
// helper in place so we can re-tighten without restructuring callers.
const OPUS_47_ALLOWED_EFFORTS: Array<ClaudeOpus47Effort> = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

function getAllowedClaudeEfforts(modelId: string): Array<ClaudeOpus47Effort> {
  if (isClaudeOpus47Model(modelId)) {
    return OPUS_47_ALLOWED_EFFORTS
  }
  return []
}

function capClaudeEffort(
  modelId: string,
  effort: ClaudeOpus47Effort | undefined,
): ClaudeOpus47Effort | undefined {
  if (!effort) {
    return undefined
  }
  const allowed = getAllowedClaudeEfforts(modelId)
  if (allowed.length === 0) {
    return effort
  }
  if (allowed.includes(effort)) {
    return effort
  }
  const capped = allowed.at(-1)
  consola.warn(
    `[${modelId}] effort "${effort}" exceeds cap; downgraded to "${capped}"`,
  )
  return capped
}

function normalizeClaudeEffort(
  value: string | undefined,
): ClaudeOpus47Effort | undefined {
  switch (value?.toLowerCase()) {
    case "low": {
      return "low"
    }
    case "medium": {
      return "medium"
    }
    case "high": {
      return "high"
    }
    case "xhigh": {
      return "xhigh"
    }
    case "max": {
      return "max"
    }
    default: {
      return undefined
    }
  }
}

function getClaudeOpus47Effort(
  payload: AnthropicMessagesPayload,
): ClaudeOpus47Effort | undefined {
  const explicitEffort = normalizeClaudeEffort(payload.reasoning_effort)
  if (explicitEffort) {
    return explicitEffort
  }

  if (payload.thinking?.type !== "enabled") {
    return undefined
  }

  const budgetTokens = payload.thinking.budget_tokens
  if (budgetTokens === undefined) {
    return "medium"
  }

  if (budgetTokens <= 2_048) {
    return "low"
  }

  if (budgetTokens <= 8_192) {
    return "medium"
  }

  if (budgetTokens <= 24_576) {
    return "high"
  }

  return "xhigh"
}

function translateThinking(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload["thinking"] {
  // Always drop the thinking field. Upstream Copilot opus-4.7 controls
  // reasoning depth via output_config.effort instead. Forwarding the Anthropic
  // thinking field has caused 400s ("Input tag 'adaptive'...") even after
  // coercing type to "enabled" — the upstream validator appears to scan the
  // overall request body, including conversation content, for thinking-shaped
  // strings, which is fragile. Effort already conveys intent; thinking is
  // redundant for this provider.
  void payload
  return undefined
}

function translateOutputConfig(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload["output_config"] {
  const modelId = translateModelName(payload.model)

  if (!isClaudeOpus47Model(modelId)) {
    return undefined
  }

  const raw = getClaudeOpus47Effort(payload)
  const capped = capClaudeEffort(modelId, raw)

  return capped ? { effort: capped } : undefined
}

function translateReasoningEffort(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload["reasoning_effort"] {
  const modelId = translateModelName(payload.model)

  if (isClaudeModel(modelId)) {
    return undefined
  }

  if (payload.reasoning_effort) {
    return sanitizeReasoningEffortForModel(
      modelId,
      normalizeReasoningEffort(payload.reasoning_effort),
    )
  }

  if (payload.thinking?.type !== "enabled") {
    return undefined
  }

  const budgetTokens = payload.thinking.budget_tokens
  if (budgetTokens === undefined) {
    return "medium"
  }

  if (budgetTokens <= 2_048) {
    return "low"
  }

  if (budgetTokens <= 8_192) {
    return "medium"
  }

  if (budgetTokens <= 24_576) {
    return sanitizeReasoningEffortForModel(modelId, "high")
  }

  return sanitizeReasoningEffortForModel(modelId, "xhigh")
}

function normalizeReasoningEffort(
  value: string,
): ChatCompletionsPayload["reasoning_effort"] {
  switch (value.toLowerCase()) {
    case "none": {
      return "none"
    }
    case "low": {
      return "low"
    }
    case "medium": {
      return "medium"
    }
    case "high": {
      return "high"
    }
    case "xhigh": {
      return "xhigh"
    }
    case "max": {
      return "max"
    }
    default: {
      return undefined
    }
  }
}

function translateModelName(model: string): string {
  return resolveModelId(model)
}

function translateAnthropicMessagesToOpenAI(
  anthropicMessages: Array<AnthropicMessage>,
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  const systemMessages = handleSystemPrompt(system)

  const otherMessages = anthropicMessages.flatMap((message) =>
    message.role === "user" ?
      handleUserMessage(message)
    : handleAssistantMessage(message),
  )

  return [...systemMessages, ...otherMessages]
}

function handleSystemPrompt(
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  if (!system) {
    return []
  }

  if (typeof system === "string") {
    return [{ role: "system", content: system }]
  } else {
    const systemText = system.map((block) => block.text).join("\n\n")
    return [{ role: "system", content: systemText }]
  }
}

function handleUserMessage(message: AnthropicUserMessage): Array<Message> {
  const newMessages: Array<Message> = []

  if (Array.isArray(message.content)) {
    const toolResultBlocks = message.content.filter(
      (block): block is AnthropicToolResultBlock =>
        block.type === "tool_result",
    )
    const otherBlocks = message.content.filter(
      (block) => block.type !== "tool_result",
    )

    // Tool results must come first to maintain protocol: tool_use -> tool_result -> user
    for (const block of toolResultBlocks) {
      newMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: mapContent(block.content),
      })
    }

    if (otherBlocks.length > 0) {
      newMessages.push({
        role: "user",
        content: mapContent(otherBlocks),
      })
    }
  } else {
    newMessages.push({
      role: "user",
      content: mapContent(message.content),
    })
  }

  return newMessages
}

function handleAssistantMessage(
  message: AnthropicAssistantMessage,
): Array<Message> {
  if (!Array.isArray(message.content)) {
    return [
      {
        role: "assistant",
        content: mapContent(message.content),
      },
    ]
  }

  const toolUseBlocks = message.content.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  )

  const textBlocks = message.content.filter(
    (block): block is AnthropicTextBlock => block.type === "text",
  )

  const thinkingBlocks = message.content.filter(
    (block): block is AnthropicThinkingBlock => block.type === "thinking",
  )

  // Combine text and thinking blocks, as OpenAI doesn't have separate thinking blocks
  const allTextContent = [
    ...textBlocks.map((b) => b.text),
    ...thinkingBlocks.map((b) => b.thinking),
  ].join("\n\n")

  return toolUseBlocks.length > 0 ?
      [
        {
          role: "assistant",
          content: allTextContent || null,
          tool_calls: toolUseBlocks.map((toolUse) => ({
            id: toolUse.id,
            type: "function",
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input),
            },
          })),
        },
      ]
    : [
        {
          role: "assistant",
          content: mapContent(message.content),
        },
      ]
}

function mapContent(
  content:
    | string
    | Array<AnthropicUserContentBlock | AnthropicAssistantContentBlock>,
): string | Array<ContentPart> | null {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return null
  }

  const hasImage = content.some((block) => block.type === "image")
  if (!hasImage) {
    return content
      .filter(
        (block): block is AnthropicTextBlock | AnthropicThinkingBlock =>
          block.type === "text" || block.type === "thinking",
      )
      .map((block) => (block.type === "text" ? block.text : block.thinking))
      .join("\n\n")
  }

  const contentParts: Array<ContentPart> = []
  for (const block of content) {
    switch (block.type) {
      case "text": {
        contentParts.push({ type: "text", text: block.text })

        break
      }
      case "thinking": {
        contentParts.push({ type: "text", text: block.thinking })

        break
      }
      case "image": {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        })

        break
      }
      // No default
    }
  }
  return contentParts
}

function translateAnthropicToolsToOpenAI(
  anthropicTools: Array<AnthropicTool> | undefined,
): Array<Tool> | undefined {
  if (!anthropicTools) {
    return undefined
  }
  return anthropicTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function translateAnthropicToolChoiceToOpenAI(
  anthropicToolChoice: AnthropicMessagesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!anthropicToolChoice) {
    return undefined
  }

  switch (anthropicToolChoice.type) {
    case "auto": {
      return "auto"
    }
    case "any": {
      return "required"
    }
    case "tool": {
      if (anthropicToolChoice.name) {
        return {
          type: "function",
          function: { name: anthropicToolChoice.name },
        }
      }
      return undefined
    }
    case "none": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// Response translation

export function translateToAnthropic(
  response: ChatCompletionResponse,
): AnthropicResponse {
  // Merge content from all choices
  const allTextBlocks: Array<AnthropicTextBlock> = []
  const allToolUseBlocks: Array<AnthropicToolUseBlock> = []
  let stopReason: "stop" | "length" | "tool_calls" | "content_filter" | null =
    null // default
  stopReason = response.choices[0]?.finish_reason ?? stopReason

  // Process all choices to extract text and tool use blocks
  for (const choice of response.choices) {
    const textBlocks = getAnthropicTextBlocks(choice.message.content)
    const toolUseBlocks = getAnthropicToolUseBlocks(choice.message.tool_calls)

    allTextBlocks.push(...textBlocks)
    allToolUseBlocks.push(...toolUseBlocks)

    // Use the finish_reason from the first choice, or prioritize tool_calls
    if (choice.finish_reason === "tool_calls" || stopReason === "stop") {
      stopReason = choice.finish_reason
    }
  }

  // Note: GitHub Copilot doesn't generate thinking blocks, so we don't include them in responses

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content: [...allTextBlocks, ...allToolUseBlocks],
    stop_reason: mapOpenAIStopReasonToAnthropic(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens:
        (response.usage?.prompt_tokens ?? 0)
        - (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: response.usage?.completion_tokens ?? 0,
      ...(response.usage?.prompt_tokens_details?.cached_tokens
        !== undefined && {
        cache_read_input_tokens:
          response.usage.prompt_tokens_details.cached_tokens,
      }),
    },
  }
}

function getAnthropicTextBlocks(
  messageContent: Message["content"],
): Array<AnthropicTextBlock> {
  if (typeof messageContent === "string") {
    return [{ type: "text", text: messageContent }]
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => ({ type: "text", text: part.text }))
  }

  return []
}

function getAnthropicToolUseBlocks(
  toolCalls: Array<ToolCall> | undefined,
): Array<AnthropicToolUseBlock> {
  if (!toolCalls) {
    return []
  }
  return toolCalls.map((toolCall) => ({
    type: "tool_use",
    id: toolCall.id,
    name: toolCall.function.name,
    input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
  }))
}
