import { type AnthropicResponse } from "./anthropic-types"

export function mapOpenAIStopReasonToAnthropic(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) {
    return null
  }
  const stopReasonMap = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const
  return stopReasonMap[finishReason]
}

export function sanitizeClaudeCodeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "Read") {
    return input
  }

  const sanitized = { ...input }

  if (!sanitized.file_path && typeof sanitized.path === "string") {
    sanitized.file_path = sanitized.path
  }

  if (Array.isArray(sanitized.view_range) && sanitized.view_range.length > 0) {
    const start = Number(sanitized.view_range[0])
    if (!Number.isNaN(start) && sanitized.offset === undefined) {
      sanitized.offset = start
    }

    if (sanitized.view_range.length > 1) {
      const end = Number(sanitized.view_range[1])
      if (
        !Number.isNaN(start)
        && !Number.isNaN(end)
        && end >= start
        && sanitized.limit === undefined
      ) {
        sanitized.limit = end - start + 1
      }
    }
  }

  delete sanitized.page
  delete sanitized.pages
  delete sanitized.path
  delete sanitized.view_range
  delete sanitized.forceReadLargeFiles
  delete sanitized.start_index

  return sanitized
}
