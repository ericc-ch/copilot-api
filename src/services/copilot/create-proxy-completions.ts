import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

const DEFAULT_PROXY_BASE_URL = "https://copilot-proxy.githubusercontent.com"

/**
 * Legacy "-copilot" engine models (e.g. `gpt-41-copilot` used for inline
 * fill-in-the-middle suggestions) are not served by the CAPI chat endpoints;
 * they live behind the traditional Copilot proxy completions API:
 *
 *   POST {proxyBase}/v1/engines/{model}/completions   (stream ONLY)
 *
 * The proxy rejects non-streaming requests, so `stream: true` is always
 * forced upstream and aggregated for clients that ask for a full response.
 */
export const createProxyCompletions = async (payload: CompletionsPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const base = await ensureProxyBaseUrl()
  const response = await fetch(
    `${base}/v1/engines/${encodeURIComponent(payload.model)}/completions`,
    {
      method: "POST",
      headers: copilotHeaders(state),
      body: JSON.stringify({ ...payload, stream: true }),
    },
  )

  if (!response.ok) {
    throw new HTTPError("Failed to create completions", response)
  }

  return response
}

/** Aggregates the streaming upstream response into one legacy completion. */
export const aggregateProxyCompletionsStream = async (
  payload: CompletionsPayload,
): Promise<ProxyCompletionResult> => {
  const response = await createProxyCompletions(payload)

  let id = ""
  // n>1 requests stream every choice independently by index; keep them
  // separate so non-streaming clients receive all completions
  const byIndex = new Map<
    number,
    { text: string; finishReason: string | null }
  >()

  for await (const event of events(response)) {
    if (!event.data) continue
    if (event.data === "[DO" + "NE]") break
    const chunk = JSON.parse(event.data) as LegacyCompletionChunk
    if (chunk.id) id = chunk.id
    for (const choice of chunk.choices ?? []) {
      const index = typeof choice.index === "number" ? choice.index : 0
      const entry = byIndex.get(index) ?? { text: "", finishReason: null }
      if (typeof choice.text === "string") entry.text += choice.text
      if (choice.finish_reason) entry.finishReason = choice.finish_reason
      byIndex.set(index, entry)
    }
  }

  const choices = [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entry]) => ({
      text: entry.text,
      index,
      finish_reason: entry.finishReason ?? "stop",
      logprobs: null,
    }))

  return {
    id,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    choices:
      choices.length > 0 ?
        choices
      : [{ text: "", index: 0, finish_reason: "stop", logprobs: null }],
  }
}

let proxyPending: Promise<string> | undefined
// a failed lookup pins the default base only briefly, so a transient
// /copilot_internal/user failure does not stick until restart
const PROXY_FALLBACK_RETRY_MS = 5 * 60 * 1000
let proxyFallbackAfter = 0

const ensureProxyBaseUrl = async (): Promise<string> => {
  const cached = state.proxyBaseUrl
  if (cached && cached !== DEFAULT_PROXY_BASE_URL) return cached
  if (cached && performance.now() < proxyFallbackAfter) return cached

  // share one in-flight /copilot_internal/user lookup across concurrent
  // first requests
  proxyPending ??= resolveProxyBaseUrl().finally(() => {
    proxyPending = undefined
  })
  return proxyPending
}

const resolveProxyBaseUrl = async (): Promise<string> => {
  try {
    const usage = await getCopilotUsage()
    const proxy = usage.endpoints?.proxy
    if (proxy) {
      state.proxyBaseUrl = proxy
      return proxy
    }
  } catch (error) {
    consola.warn("Failed to resolve proxy base URL, using default:", error)
  }

  proxyFallbackAfter = performance.now() + PROXY_FALLBACK_RETRY_MS

  state.proxyBaseUrl = DEFAULT_PROXY_BASE_URL
  return DEFAULT_PROXY_BASE_URL
}

/** Test-only: clears single-flight/backoff between tests. */
export const __resetProxyBaseUrlForTests = (): void => {
  proxyPending = undefined
  proxyFallbackAfter = 0
}

export interface CompletionsPayload {
  model: string
  prompt: string | Array<string>
  max_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  n?: number | null
  stream?: boolean | null
  stop?: string | Array<string> | null
  suffix?: string | null
  [key: string]: unknown
}

interface LegacyCompletionChunk {
  id?: string
  model?: string
  choices?: Array<{
    text?: string
    index: number
    finish_reason: string | null
  }>
}

export interface ProxyCompletionResult {
  id: string
  object: "text_completion"
  created: number
  model: string
  choices: Array<{
    text: string
    index: number
    finish_reason: string
    logprobs: null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
