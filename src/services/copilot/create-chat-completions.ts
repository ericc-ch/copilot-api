import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { getClaudeSettingsEnv } from "~/lib/claude-settings"
import { HTTPError } from "~/lib/error"
import { isClaudeOpus47Model } from "~/lib/models"
import { state } from "~/lib/state"

import {
  buildResponsesRequestPayload,
  shouldUseResponsesApiForModel,
  translateResponsesStreamToChatCompletionStream,
  translateResponsesToChatCompletion,
  type ResponsesApiResponse,
  type ResponsesReasoningEffort,
} from "./responses"

const usesMaxCompletionTokens = (modelId: string): boolean =>
  modelId.startsWith("gpt-5")

type ClaudeOpus47Effort = NonNullable<
  NonNullable<ChatCompletionsPayload["output_config"]>["effort"]
>

// Per-model effort caps for Claude. Mirror of the helper in
// routes/messages/non-stream-translation.ts — keep in sync.
// 2026-04 probe: upstream now accepts low/medium/high/xhigh/max for opus-4.7.
const OPUS_47_ALLOWED_EFFORTS: Array<ClaudeOpus47Effort> = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

export const getAllowedClaudeEfforts = (
  modelId: string,
): Array<ClaudeOpus47Effort> =>
  isClaudeOpus47Model(modelId) ? OPUS_47_ALLOWED_EFFORTS : []

const sanitizeClaudeEffortForModel = (
  modelId: string,
  effort: ClaudeOpus47Effort | undefined,
): ClaudeOpus47Effort | undefined => {
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

// Copilot rejects user identifiers longer than 64 characters.
const MAX_USER_LENGTH = 64

const defaultReasoningEffort = (
  modelId: string,
): ChatCompletionsPayload["reasoning_effort"] =>
  usesMaxCompletionTokens(modelId) ? "medium" : undefined

const getAllowedReasoningEfforts = (
  modelId: string,
): Array<
  Exclude<ChatCompletionsPayload["reasoning_effort"], null | undefined>
> => {
  if (modelId.startsWith("gpt-5.4-mini")) {
    return ["none", "low", "medium"]
  }

  if (modelId.startsWith("gpt-5.4") || modelId.startsWith("gpt-5.3-codex")) {
    return ["low", "medium", "high", "xhigh"]
  }

  if (usesMaxCompletionTokens(modelId)) {
    return ["low", "medium", "high", "xhigh"]
  }

  return []
}

export const sanitizeReasoningEffortForModel = (
  modelId: string,
  reasoningEffort: ChatCompletionsPayload["reasoning_effort"],
): ChatCompletionsPayload["reasoning_effort"] => {
  if (!reasoningEffort) {
    return undefined
  }

  return getAllowedReasoningEfforts(modelId).includes(reasoningEffort) ?
      reasoningEffort
    : undefined
}

const getRequestedReasoningEffort = (
  payload: ChatCompletionsPayload,
  claudeSettingsEnv: Record<string, string>,
): ChatCompletionsPayload["reasoning_effort"] => {
  const requestedReasoningEffort =
    payload.reasoning_effort
    ?? normalizeReasoningEffort(process.env.COPILOT_REASONING_EFFORT)
    ?? normalizeReasoningEffort(claudeSettingsEnv.COPILOT_REASONING_EFFORT)

  return (
    sanitizeReasoningEffortForModel(payload.model, requestedReasoningEffort)
    ?? defaultReasoningEffort(payload.model)
  )
}

const normalizeReasoningEffort = (
  value: string | undefined | null,
): ChatCompletionsPayload["reasoning_effort"] => {
  switch (value?.toLowerCase()) {
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

const normalizeClaudeOpus47Effort = (
  value: string | undefined | null,
): ClaudeOpus47Effort | undefined => {
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

const getRequestedClaudeOpus47Effort = (
  payload: ChatCompletionsPayload,
  claudeSettingsEnv: Record<string, string>,
): ClaudeOpus47Effort | undefined => {
  if (!isClaudeOpus47Model(payload.model)) {
    return undefined
  }

  const raw =
    payload.output_config?.effort
    ?? normalizeClaudeOpus47Effort(payload.reasoning_effort)
    ?? normalizeClaudeOpus47Effort(process.env.COPILOT_REASONING_EFFORT)
    ?? normalizeClaudeOpus47Effort(claudeSettingsEnv.COPILOT_REASONING_EFFORT)

  return sanitizeClaudeEffortForModel(payload.model, raw)
}

export const sanitizeUserIdentifier = (
  user: string | null | undefined,
): string | undefined => {
  if (!user) {
    return undefined
  }

  return user.slice(0, MAX_USER_LENGTH)
}

const buildRequestPayload = (
  payload: ChatCompletionsPayload,
  claudeSettingsEnv: Record<string, string>,
): ChatCompletionsRequestPayload => {
  const requestedReasoningEffort = getRequestedReasoningEffort(
    payload,
    claudeSettingsEnv,
  )
  const requestedClaudeOpus47Effort = getRequestedClaudeOpus47Effort(
    payload,
    claudeSettingsEnv,
  )

  const reasoningEffort =
    (
      usesMaxCompletionTokens(payload.model)
      && payload.tools !== null
      && payload.tools !== undefined
      && payload.tools.length > 0
    ) ?
      undefined
    : requestedReasoningEffort

  if (
    !usesMaxCompletionTokens(payload.model)
    || payload.max_tokens === null
    || payload.max_tokens === undefined
  ) {
    const sanitizedPayload = {
      ...payload,
      output_config:
        requestedClaudeOpus47Effort ?
          {
            ...payload.output_config,
            effort: requestedClaudeOpus47Effort,
          }
        : payload.output_config,
      reasoning_effort:
        isClaudeOpus47Model(payload.model) ? undefined : (
          payload.reasoning_effort
        ),
      user: sanitizeUserIdentifier(payload.user),
    }

    return reasoningEffort === null || reasoningEffort === undefined ?
        sanitizedPayload
      : { ...sanitizedPayload, reasoning_effort: reasoningEffort }
  }

  return {
    ...payload,
    max_tokens: undefined,
    max_completion_tokens: payload.max_tokens,
    reasoning_effort: reasoningEffort,
    user: sanitizeUserIdentifier(payload.user),
  }
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const claudeSettingsEnv = await getClaudeSettingsEnv()
  const requestPayload = buildRequestPayload(payload, claudeSettingsEnv)

  if (shouldUseResponsesApiForModel(payload.model)) {
    return createResponses(payload, headers, claudeSettingsEnv)
  }

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    if (await shouldRetryWithResponses(response)) {
      return createResponses(payload, headers, claudeSettingsEnv)
    }

    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

async function createResponses(
  payload: ChatCompletionsPayload,
  headers: Record<string, string>,
  claudeSettingsEnv: Record<string, string>,
) {
  const reasoningEffort = getRequestedReasoningEffort(
    payload,
    claudeSettingsEnv,
  ) as ResponsesReasoningEffort | undefined

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      buildResponsesRequestPayload(payload, reasoningEffort),
    ),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return translateResponsesStreamToChatCompletionStream(events(response))
  }

  return translateResponsesToChatCompletion(
    (await response.json()) as ResponsesApiResponse,
  )
}

async function shouldRetryWithResponses(response: Response): Promise<boolean> {
  try {
    const errorBody = (await response.clone().json()) as {
      error?: {
        code?: string
      }
    }

    return errorBody.error?.code === "unsupported_api_for_model"
  } catch {
    return false
  }
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
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

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  thinking?: {
    type: "enabled" | "adaptive"
    budget_tokens?: number
  } | null
  output_config?: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max"
  } | null
  reasoning_effort?: "none" | "low" | "medium" | "high" | "max" | "xhigh" | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

type ChatCompletionsRequestPayload = Omit<
  ChatCompletionsPayload,
  "max_tokens"
> & {
  max_tokens?: number | null
  max_completion_tokens?: number | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
