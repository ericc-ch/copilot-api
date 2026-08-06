// Anthropic API Types

import type { ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

export interface AnthropicMessagesPayload {
  model: string
  messages: Array<AnthropicMessage>
  max_tokens: number
  system?: string | Array<AnthropicTextBlock>
  metadata?: {
    user_id?: string
  }
  stop_sequences?: Array<string>
  stream?: boolean
  temperature?: number
  top_p?: number
  top_k?: number
  tools?: Array<AnthropicTool>
  tool_choice?: {
    type: "auto" | "any" | "tool" | "none"
    name?: string
  }
  thinking?: {
    type: "adaptive" | "enabled"
    budget_tokens?: number
  }
  output_config?: {
    effort?: "none" | "low" | "medium" | "high" | "xhigh" | "max"
  }
  service_tier?: "auto" | "standard_only"
}

export interface AnthropicTextBlock {
  type: "text"
  text: string
}

export interface AnthropicImageBlock {
  type: "image"
  source: {
    type: "base64"
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    data: string
  }
}

export interface AnthropicToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>
  is_error?: boolean
}

export interface AnthropicToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicThinkingBlock {
  type: "thinking"
  thinking: string
  signature?: string
}

export interface AnthropicServerToolUseBlock {
  type: "server_tool_use"
  id: string
  name: "web_search"
  input: {
    query: string
  }
}

export interface AnthropicWebSearchResult {
  type: "web_search_result"
  url: string
  title: string
  page_age: string | null
  encrypted_content: string
}

export interface AnthropicWebSearchToolResultBlock {
  type: "web_search_tool_result"
  tool_use_id: string
  content: Array<AnthropicWebSearchResult>
}

export type AnthropicUserContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolResultBlock

export type AnthropicAssistantContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock
  | AnthropicServerToolUseBlock
  | AnthropicWebSearchToolResultBlock

export interface AnthropicUserMessage {
  role: "user"
  content: string | Array<AnthropicUserContentBlock>
}

export interface AnthropicAssistantMessage {
  role: "assistant"
  content: string | Array<AnthropicAssistantContentBlock>
}

export type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage

export interface AnthropicClientTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface AnthropicWebSearchTool {
  type: `web_search_${string}`
  name: "web_search"
  max_uses?: number
  allowed_domains?: Array<string>
  blocked_domains?: Array<string>
  user_location?: {
    type: "approximate"
    city?: string
    region?: string
    country?: string
    timezone?: string
  }
  allowed_callers?: Array<"direct" | "code_execution_20250825">
}

export type AnthropicTool = AnthropicClientTool | AnthropicWebSearchTool

export interface AnthropicResponse {
  id: string
  type: "message"
  role: "assistant"
  content: Array<AnthropicAssistantContentBlock>
  model: string
  stop_reason:
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "pause_turn"
    | "refusal"
    | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    server_tool_use?: {
      web_search_requests?: number
    }
    service_tier?: "standard" | "priority" | "batch"
  }
}

export type AnthropicResponseContentBlock = AnthropicAssistantContentBlock

// Anthropic Stream Event Types
export interface AnthropicMessageStartEvent {
  type: "message_start"
  message: Omit<
    AnthropicResponse,
    "content" | "stop_reason" | "stop_sequence"
  > & {
    content: []
    stop_reason: null
    stop_sequence: null
  }
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start"
  index: number
  content_block:
    | { type: "text"; text: string }
    | (Omit<AnthropicToolUseBlock, "input"> & {
        input: Record<string, unknown>
      })
    | { type: "thinking"; thinking: string }
    | (Omit<AnthropicServerToolUseBlock, "input"> & {
        input: Record<string, unknown>
      })
    | AnthropicWebSearchToolResultBlock
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta"
  index: number
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "signature_delta"; signature: string }
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop"
  index: number
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta"
  delta: {
    stop_reason?: AnthropicResponse["stop_reason"]
    stop_sequence?: string | null
  }
  usage?: {
    input_tokens?: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    server_tool_use?: {
      web_search_requests?: number
    }
  }
}

export interface AnthropicMessageStopEvent {
  type: "message_stop"
}

export interface AnthropicPingEvent {
  type: "ping"
}

export interface AnthropicErrorEvent {
  type: "error"
  error: {
    type: string
    message: string
  }
}

export type AnthropicStreamEventData =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicErrorEvent

// State for streaming translation
export interface AnthropicStreamState {
  messageStartSent: boolean
  messageCompleted: boolean
  nextBlockIndex: number
  // Blocks that have had content_block_start but not content_block_stop.
  openBlockIndices: Set<number>
  // Open text block receiving content deltas, if any.
  textBlockIndex?: number
  stopReason?: "stop" | "length" | "tool_calls" | "content_filter"
  // Latest usage seen on any chunk, including trailing usage-only chunks.
  usage?: ChatCompletionChunk["usage"]
  toolCalls: {
    [openAIToolIndex: number]: {
      id: string
      name: string
      anthropicBlockIndex: number
    }
  }
}
