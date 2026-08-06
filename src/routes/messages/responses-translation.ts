import consola from "consola"

import type {
  ResponseFunctionCall,
  ResponseFunctionCallOutput,
  ResponseInputContent,
  ResponseInputItem,
  ResponseInputMessage,
  ResponseOutputContent,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputReasoning,
  ResponseOutputWebSearchCall,
  ResponsesPayload,
  ResponsesResult,
  ResponseTool,
  ResponseToolChoice,
  ResponseWebSearchTool,
} from "~/services/copilot/create-responses"

import type {
  AnthropicAssistantContentBlock,
  AnthropicAssistantMessage,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessagesPayload,
  AnthropicResponse,
  AnthropicServerToolUseBlock,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicTool,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  AnthropicUserMessage,
  AnthropicWebSearchResult,
  AnthropicWebSearchTool,
  AnthropicWebSearchToolResultBlock,
} from "./anthropic-types"

const REASONING_SIGNATURE_SEPARATOR = "@"

export function translateAnthropicToResponses(
  payload: AnthropicMessagesPayload,
): ResponsesPayload {
  const hasWebSearch = payload.tools?.some(
    (tool) => "type" in tool && tool.type.startsWith("web_search"),
  )
  return {
    model: payload.model,
    input: payload.messages.flatMap((message) => translateMessage(message)),
    instructions: translateSystem(payload.system),
    max_output_tokens: payload.max_tokens,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    metadata:
      payload.metadata?.user_id ? { user_id: payload.metadata.user_id } : null,
    stream: payload.stream ?? false,
    store: false,
    parallel_tool_calls: true,
    ...(payload.output_config?.effort ?
      {
        reasoning: {
          effort: payload.output_config.effort,
          summary: "auto",
        },
      }
    : {}),
    include: [
      "reasoning.encrypted_content",
      // Search result URLs otherwise stay hidden inside text annotations
      ...(hasWebSearch ? (["web_search_call.action.sources"] as const) : []),
    ],
  }
}

function translateMessage(message: AnthropicMessage): Array<ResponseInputItem> {
  if (message.role === "user") {
    return translateUserMessage(message)
  }
  return translateAssistantMessage(message)
}

function translateUserMessage(
  message: AnthropicUserMessage,
): Array<ResponseInputItem> {
  if (typeof message.content === "string") {
    return [createMessage("user", message.content)]
  }

  const input: Array<ResponseInputItem> = []
  const pendingContent: Array<ResponseInputContent> = []

  for (const block of message.content) {
    if (block.type === "tool_result") {
      flushMessage("user", pendingContent, input)
      input.push(translateToolResult(block))
      continue
    }

    if (block.type === "text") {
      pendingContent.push({ type: "input_text", text: block.text })
      continue
    }

    pendingContent.push(translateImage(block))
  }

  flushMessage("user", pendingContent, input)
  return input
}

function translateAssistantMessage(
  message: AnthropicAssistantMessage,
): Array<ResponseInputItem> {
  if (typeof message.content === "string") {
    return [createMessage("assistant", message.content)]
  }

  const input: Array<ResponseInputItem> = []
  const pendingContent: Array<ResponseInputContent> = []

  for (const block of message.content) {
    if (block.type === "tool_use") {
      flushMessage("assistant", pendingContent, input)
      input.push(translateToolUse(block))
      continue
    }

    if (block.type === "thinking") {
      flushMessage("assistant", pendingContent, input)
      const reasoning = translateThinking(block)
      if (reasoning) input.push(reasoning)
      continue
    }

    if (
      block.type === "server_tool_use"
      || block.type === "web_search_tool_result"
    ) {
      flushMessage("assistant", pendingContent, input)
      continue
    }

    pendingContent.push({ type: "output_text", text: block.text })
  }

  flushMessage("assistant", pendingContent, input)
  return input
}

function createMessage(
  role: ResponseInputMessage["role"],
  content: string | Array<ResponseInputContent>,
): ResponseInputMessage {
  return {
    type: "message",
    role,
    content,
  }
}

function flushMessage(
  role: ResponseInputMessage["role"],
  content: Array<ResponseInputContent>,
  input: Array<ResponseInputItem>,
): void {
  if (content.length === 0) return
  input.push(createMessage(role, [...content]))
  content.length = 0
}

function translateImage(block: AnthropicImageBlock): ResponseInputContent {
  return {
    type: "input_image",
    image_url: `data:${block.source.media_type};base64,${block.source.data}`,
    detail: "auto",
  }
}

function translateToolUse(block: AnthropicToolUseBlock): ResponseFunctionCall {
  return {
    type: "function_call",
    call_id: block.id,
    name: block.name,
    arguments: JSON.stringify(block.input),
    status: "completed",
  }
}

function translateToolResult(
  block: AnthropicToolResultBlock,
): ResponseFunctionCallOutput {
  return {
    type: "function_call_output",
    call_id: block.tool_use_id,
    output: stringifyToolResult(block.content),
    status: block.is_error ? "incomplete" : "completed",
  }
}

function stringifyToolResult(
  content: AnthropicToolResultBlock["content"],
): string {
  if (typeof content === "string") return content
  return content
    .map((block) =>
      block.type === "text" ?
        block.text
      : `[image:${block.source.media_type};base64,${block.source.data}]`,
    )
    .join("\n")
}

function translateThinking(
  block: AnthropicThinkingBlock,
): ResponseInputItem | null {
  if (!block.signature) return null
  const separator = block.signature.lastIndexOf(REASONING_SIGNATURE_SEPARATOR)
  if (separator <= 0 || separator === block.signature.length - 1) return null

  return {
    type: "reasoning",
    encrypted_content: block.signature.slice(0, separator),
    id: block.signature.slice(separator + 1),
    summary:
      block.thinking ? [{ type: "summary_text", text: block.thinking }] : [],
  }
}

function translateSystem(
  system: string | Array<AnthropicTextBlock> | undefined,
): string | null {
  if (typeof system === "string") return system
  if (!system) return null
  const text = system.map((block) => block.text).join("\n\n")
  return text || null
}

function translateTools(
  tools: Array<AnthropicTool> | undefined,
): Array<ResponseTool> | null {
  if (!tools?.length) return null
  return tools.map((tool) =>
    "input_schema" in tool ?
      {
        type: "function",
        name: tool.name,
        parameters: tool.input_schema,
        strict: false,
        ...(tool.description ? { description: tool.description } : {}),
      }
    : translateWebSearchTool(tool),
  )
}

function translateWebSearchTool(
  tool: AnthropicWebSearchTool,
): ResponseWebSearchTool {
  if (tool.blocked_domains?.length) {
    throw new TypeError(
      "Copilot Responses web search does not support blocked_domains",
    )
  }

  return {
    type: "web_search",
    ...(tool.allowed_domains?.length ?
      { filters: { allowed_domains: tool.allowed_domains } }
    : {}),
    ...(tool.user_location ? { user_location: tool.user_location } : {}),
  }
}

function translateToolChoice(
  choice: AnthropicMessagesPayload["tool_choice"],
): ResponseToolChoice {
  switch (choice?.type) {
    case "any": {
      return "required"
    }
    case "none": {
      return "none"
    }
    case "tool": {
      return choice.name && choice.name !== "web_search" ?
          { type: "function", name: choice.name }
        : "auto"
    }
    default: {
      return "auto"
    }
  }
}

export function translateResponsesToAnthropic(
  response: ResponsesResult,
): AnthropicResponse {
  const content = response.output.flatMap((item) => translateOutputItem(item))
  const hasToolUse = content.some((block) => block.type === "tool_use")
  const webSearchRequests = response.output.filter(
    (item) => item.type === "web_search_call",
  ).length
  const inputTokens = response.usage?.input_tokens ?? 0
  const cachedTokens = response.usage?.input_tokens_details?.cached_tokens
  const cacheWriteTokens =
    response.usage?.input_tokens_details?.cache_write_tokens

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    content: content.length > 0 ? content : fallbackText(response.output_text),
    model: response.model,
    stop_reason: hasToolUse ? "tool_use" : translateStopReason(response),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens - (cachedTokens ?? 0) - (cacheWriteTokens ?? 0),
      output_tokens: response.usage?.output_tokens ?? 0,
      ...(cachedTokens === undefined ?
        {}
      : { cache_read_input_tokens: cachedTokens }),
      ...(cacheWriteTokens === undefined ?
        {}
      : { cache_creation_input_tokens: cacheWriteTokens }),
      ...(webSearchRequests > 0 ?
        { server_tool_use: { web_search_requests: webSearchRequests } }
      : {}),
    },
  }
}

function translateOutputItem(
  item: ResponseOutputItem,
): Array<AnthropicAssistantContentBlock> {
  if (isReasoning(item)) {
    const thinking = item.summary
      ?.map((part) => part.text ?? "")
      .filter(Boolean)
      .join("\n\n")
    if (!item.encrypted_content) return []
    return [
      {
        type: "thinking",
        thinking: thinking || "Thinking...",
        signature: `${item.encrypted_content}${REASONING_SIGNATURE_SEPARATOR}${item.id}`,
      },
    ]
  }

  if (isFunctionCall(item)) {
    return [
      {
        type: "tool_use",
        id: item.call_id ?? item.id,
        name: item.name,
        input: parseToolArguments(item.arguments),
      },
    ]
  }

  if (isMessage(item)) {
    const text = item.content
      ?.map((block) => translateOutputContent(block))
      .filter(Boolean)
      .join("")
    return text ? [{ type: "text", text }] : []
  }

  if (isWebSearchCall(item)) {
    return translateWebSearchCallBlocks(item)
  }

  return []
}

export function translateWebSearchCallBlocks(
  call: ResponseOutputWebSearchCall,
): [AnthropicServerToolUseBlock, AnthropicWebSearchToolResultBlock] {
  return [
    {
      type: "server_tool_use",
      id: call.id,
      name: "web_search",
      input: { query: webSearchQuery(call) },
    },
    {
      type: "web_search_tool_result",
      tool_use_id: call.id,
      content: webSearchResults(call),
    },
  ]
}

function webSearchQuery(call: ResponseOutputWebSearchCall): string {
  if (call.action?.query) return call.action.query
  return call.action?.queries?.filter(Boolean).join(" | ") ?? ""
}

function webSearchResults(
  call: ResponseOutputWebSearchCall,
): Array<AnthropicWebSearchResult> {
  return (call.action?.sources ?? []).flatMap((source) =>
    source.url ?
      [
        {
          type: "web_search_result" as const,
          url: source.url,
          title: source.title ?? source.url,
          page_age: null,
          // Copilot Responses does not return re-usable result payloads.
          encrypted_content: "",
        },
      ]
    : [],
  )
}

function translateOutputContent(block: ResponseOutputContent): string {
  if (block.type === "output_text" && typeof block.text === "string") {
    return block.text
  }
  if (block.type === "refusal" && typeof block.refusal === "string") {
    return block.refusal
  }
  return ""
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { arguments: parsed }
  } catch (error) {
    consola.warn("Failed to parse Responses function arguments", {
      error,
      raw,
    })
    return { raw_arguments: raw }
  }
}

function fallbackText(
  text: string | undefined,
): Array<AnthropicAssistantContentBlock> {
  return text ? [{ type: "text", text }] : []
}

function translateStopReason(
  response: ResponsesResult,
): AnthropicResponse["stop_reason"] {
  if (response.status === "completed") return "end_turn"
  if (response.incomplete_details?.reason === "max_output_tokens") {
    return "max_tokens"
  }
  return null
}

function isMessage(item: ResponseOutputItem): item is ResponseOutputMessage {
  return item.type === "message"
}

function isReasoning(
  item: ResponseOutputItem,
): item is ResponseOutputReasoning {
  return item.type === "reasoning"
}

function isFunctionCall(
  item: ResponseOutputItem,
): item is ResponseOutputFunctionCall {
  return item.type === "function_call"
}

function isWebSearchCall(
  item: ResponseOutputItem,
): item is ResponseOutputWebSearchCall {
  return item.type === "web_search_call"
}
