import consola from "consola"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

/**
 * Sanitize an Anthropic /v1/messages payload for Copilot backend compatibility.
 *
 * Based on live probe results from tests/copilot-native-probes.ts:
 * - All models: strip context_management, budget_tokens, defer_loading, tool_reference
 * - opus: thinking.enabled → adaptive, effort only accepts "medium"
 */

export function sanitizeForCopilotBackend(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizePayload(
    payload as unknown as AnthropicMessagesPayload,
  ) as unknown as Record<string, unknown>
}

export function sanitizePayload(
  payload: AnthropicMessagesPayload,
): AnthropicMessagesPayload {
  // Deep clone to avoid mutating the original
  const sanitized = structuredClone(payload) as AnthropicMessagesPayload
    & Record<string, unknown>

  // 1. Normalize model name (Copilot uses short names)
  sanitized.model = normalizeModelName(sanitized.model)

  // 2. Strip context_management (rejected by all models)
  if ("context_management" in sanitized) {
    consola.debug("Stripping context_management from request")
    delete sanitized.context_management
  }

  // 3. Handle thinking block
  if (sanitized.thinking) {
    const isOpus = isOpusModel(sanitized.model)

    if (isOpus) {
      // opus models: thinking.enabled → adaptive
      consola.debug("opus: Converting thinking to adaptive")
      sanitized.thinking = { type: "adaptive" } as typeof sanitized.thinking
    }

    // All models: strip budget_tokens from thinking
    if ("budget_tokens" in sanitized.thinking) {
      consola.debug("Stripping budget_tokens from thinking")
      const { budget_tokens: _, ...rest } = sanitized.thinking as Record<
        string,
        unknown
      >
      sanitized.thinking = rest as typeof sanitized.thinking
    }
  }

  // 4. Handle output_config.effort for opus
  if ("output_config" in sanitized && isOpusModel(sanitized.model)) {
    const outputConfig = sanitized.output_config as
      | Record<string, unknown>
      | undefined
    if (
      outputConfig
      && typeof outputConfig.effort === "string"
      && outputConfig.effort !== "medium"
    ) {
      consola.debug(
        `opus: Normalizing effort "${outputConfig.effort}" to "medium"`,
      )
      outputConfig.effort = "medium"
    }
  }

  // 5. Strip defer_loading from tool definitions
  if (sanitized.tools) {
    for (const tool of sanitized.tools) {
      const t = tool as Record<string, unknown>
      if ("defer_loading" in t) {
        delete t.defer_loading
      }
    }
  }

  // 6. Filter tool_reference content blocks from messages
  for (const msg of sanitized.messages) {
    if (Array.isArray(msg.content)) {
      msg.content = (msg.content as Array<Record<string, unknown>>).filter(
        (block) => block.type !== "tool_reference",
      ) as typeof msg.content
    }
  }

  return sanitized
}

function normalizeModelName(model: string): string {
  if (model.startsWith("claude-sonnet-4-")) {
    return model.replace(/^claude-sonnet-4-.*/, "claude-sonnet-4")
  } else if (model.startsWith("claude-opus-4-")) {
    return model.replace(/^claude-opus-4-.*/, "claude-opus-4")
  }
  return model
}

function isOpusModel(model: string): boolean {
  return model.includes("opus")
}

/**
 * Check if a model name is a Claude model (should use native Anthropic passthrough)
 */
export function isClaude(model: string): boolean {
  return isClaudeModel(model)
}

export function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-") || model.startsWith("claude_")
}
