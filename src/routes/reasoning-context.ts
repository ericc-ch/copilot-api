import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"
import type { Model } from "~/services/copilot/get-models"

export interface ReasoningContext {
  reasoningEffort?: "low" | "medium" | "high" | (string & {})
  thinkingBudget?: number
}

function supportsReasoningEffort(model: Model | undefined): boolean {
  const levels = model?.capabilities.supports.reasoning_effort
  return Array.isArray(levels) && levels.length > 0
}

function supportsAdaptiveThinking(model: Model | undefined): boolean {
  return model?.capabilities.supports.adaptive_thinking === true
}

export function buildAnthropicReasoningContext(
  payload: AnthropicMessagesPayload,
  model: Model | undefined,
): ReasoningContext {
  const thinkingEnabled = payload.thinking?.type === "enabled"
  if (!thinkingEnabled) return {}

  return {
    reasoningEffort: supportsReasoningEffort(model) ? "high" : undefined,
    thinkingBudget:
      supportsAdaptiveThinking(model) ?
        payload.thinking?.budget_tokens
      : undefined,
  }
}

export function buildOpenAIReasoningContext(
  payload: ChatCompletionsPayload,
  model: Model | undefined,
): ReasoningContext {
  return {
    reasoningEffort:
      supportsReasoningEffort(model) ?
        (payload.reasoning_effort ?? undefined)
      : undefined,
    thinkingBudget:
      supportsAdaptiveThinking(model) ?
        (payload.thinking_budget ?? undefined)
      : undefined,
  }
}
