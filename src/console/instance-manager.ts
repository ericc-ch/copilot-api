import type { Context } from "hono"

import consola from "consola"
import { events } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import type { State } from "~/lib/state"
import type { ModelsResponse } from "~/services/copilot/get-models"

import {
  copilotBaseUrl,
  copilotHeaders,
  GITHUB_API_BASE_URL,
  githubHeaders,
  standardHeaders,
} from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { getTokenCount } from "~/lib/tokenizer"
import { type AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "~/routes/messages/non-stream-translation"
import { translateChunkToAnthropicEvents } from "~/routes/messages/stream-translation"
import {
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import type { Account } from "./account-store"

interface ProxyInstance {
  account: Account
  state: State
  status: "running" | "stopped" | "error"
  error?: string
  tokenInterval?: ReturnType<typeof setInterval>
}

const instances = new Map<string, ProxyInstance>()

function createState(account: Account): State {
  return {
    accountType: account.accountType,
    githubToken: account.githubToken,
    manualApprove: false,
    rateLimitWait: false,
    showToken: false,
  }
}

async function fetchCopilotToken(
  st: State,
): Promise<{ token: string; refresh_in: number }> {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
    { headers: githubHeaders(st) },
  )
  if (!response.ok) throw new HTTPError("Failed to get Copilot token", response)
  return (await response.json()) as { token: string; refresh_in: number }
}

async function fetchModels(st: State): Promise<ModelsResponse> {
  const response = await fetch(`${copilotBaseUrl(st)}/models`, {
    headers: copilotHeaders(st),
  })
  if (!response.ok) throw new HTTPError("Failed to get models", response)
  return (await response.json()) as ModelsResponse
}

async function setupInstanceToken(instance: ProxyInstance): Promise<void> {
  const { token, refresh_in } = await fetchCopilotToken(instance.state)
  // eslint-disable-next-line require-atomic-updates
  instance.state.copilotToken = token

  const refreshMs = (refresh_in - 60) * 1000
  // eslint-disable-next-line require-atomic-updates
  instance.tokenInterval = setInterval(() => {
    void (async () => {
      try {
        const result = await fetchCopilotToken(instance.state)
        // eslint-disable-next-line require-atomic-updates
        instance.state.copilotToken = result.token
        consola.debug(`[${instance.account.name}] Copilot token refreshed`)
      } catch (error) {
        consola.error(
          `[${instance.account.name}] Failed to refresh token:`,
          error,
        )
      }
    })()
  }, refreshMs)
}

export async function startInstance(account: Account): Promise<void> {
  const existing = instances.get(account.id)
  if (existing?.status === "running") {
    consola.warn(`Instance for ${account.name} is already running`)
    return
  }

  const st = createState(account)
  const instance: ProxyInstance = { account, state: st, status: "stopped" }

  try {
    st.vsCodeVersion = await getVSCodeVersion()
    await setupInstanceToken(instance)
    st.models = await fetchModels(st)
    instance.status = "running"
    instances.set(account.id, instance)
    consola.success(`[${account.name}] Instance ready`)
  } catch (error) {
    instance.status = "error"
    instance.error = (error as Error).message
    instances.set(account.id, instance)
    consola.error(`[${account.name}] Failed to start:`, error)
    throw error
  }
}

export function stopInstance(accountId: string): void {
  const instance = instances.get(accountId)
  if (!instance) return
  try {
    if (instance.tokenInterval) clearInterval(instance.tokenInterval)
    instance.status = "stopped"
    consola.info(`[${instance.account.name}] Instance stopped`)
  } catch (error) {
    consola.error(`[${instance.account.name}] Error stopping:`, error)
  }
}

export function getInstanceStatus(accountId: string): ProxyInstance["status"] {
  return instances.get(accountId)?.status ?? "stopped"
}

export function getInstanceError(accountId: string): string | undefined {
  return instances.get(accountId)?.error
}

export function getInstanceState(accountId: string): State | undefined {
  const instance = instances.get(accountId)
  if (!instance || instance.status !== "running") return undefined
  return instance.state
}

export async function getInstanceUsage(accountId: string): Promise<unknown> {
  const instance = instances.get(accountId)
  if (!instance || instance.status !== "running") return null
  try {
    const response = await fetch(
      `${GITHUB_API_BASE_URL}/copilot_internal/user`,
      { headers: githubHeaders(instance.state) },
    )
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function getInstanceUser(
  accountId: string,
): Promise<{ login: string } | null> {
  const instance = instances.get(accountId)
  if (!instance) return null
  try {
    const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
      headers: {
        authorization: `token ${instance.state.githubToken}`,
        ...standardHeaders(),
      },
    })
    if (!response.ok) return null
    return (await response.json()) as { login: string }
  } catch {
    return null
  }
}

// === Proxy handlers (used by unified router) ===

interface CompletionsPayload {
  messages: Array<{ role: string; content: unknown }>
  model: string
  max_tokens?: number
  stream?: boolean
}

function hasVisionContent(messages: CompletionsPayload["messages"]): boolean {
  return messages.some(
    (x) =>
      typeof x.content !== "string"
      && Array.isArray(x.content)
      && (x.content as Array<{ type: string }>).some(
        (p) => p.type === "image_url",
      ),
  )
}

function isAgentRequest(messages: CompletionsPayload["messages"]): boolean {
  return messages.some((msg) => ["assistant", "tool"].includes(msg.role))
}

export async function completionsHandler(
  c: Context,
  st: State,
): Promise<Response> {
  try {
    const payload =
      (c.get("bufferedBody") as CompletionsPayload | undefined)
      ?? (await c.req.json<CompletionsPayload>())

    const headers: Record<string, string> = {
      ...copilotHeaders(st, hasVisionContent(payload.messages)),
      "X-Initiator": isAgentRequest(payload.messages) ? "agent" : "user",
    }

    if (!payload.max_tokens) {
      const model = st.models?.data.find((m) => m.id === payload.model)
      if (model) {
        payload.max_tokens = model.capabilities.limits.max_output_tokens
      }
    }

    const response = await fetch(`${copilotBaseUrl(st)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      return c.json(
        { error: { message: text, type: "error" } },
        response.status as 400,
      )
    }

    if (payload.stream) {
      return new Response(response.body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    }

    return c.json(await response.json())
  } catch (error) {
    return c.json(
      { error: { message: (error as Error).message, type: "error" } },
      500,
    )
  }
}

export function modelsHandler(c: Context, st: State): Response {
  const models =
    st.models?.data.map((model) => ({
      id: model.id,
      object: "model",
      type: "model",
      created: 0,
      created_at: new Date(0).toISOString(),
      owned_by: model.vendor,
      display_name: model.name,
    })) ?? []
  return c.json({ object: "list", data: models, has_more: false })
}

export async function embeddingsHandler(
  c: Context,
  st: State,
): Promise<Response> {
  try {
    const payload =
      (c.get("bufferedBody") as Record<string, unknown> | undefined)
      ?? (await c.req.json<Record<string, unknown>>())
    const response = await fetch(`${copilotBaseUrl(st)}/embeddings`, {
      method: "POST",
      headers: copilotHeaders(st),
      body: JSON.stringify(payload),
    })
    if (!response.ok)
      throw new HTTPError("Failed to create embeddings", response)
    return c.json(await response.json())
  } catch (error) {
    return c.json(
      { error: { message: (error as Error).message, type: "error" } },
      500,
    )
  }
}

export async function messagesHandler(
  c: Context,
  st: State,
): Promise<Response> {
  try {
    const anthropicPayload =
      (c.get("bufferedBody") as AnthropicMessagesPayload | undefined)
      ?? (await c.req.json<AnthropicMessagesPayload>())
    const openAIPayload = translateToOpenAI(anthropicPayload)

    if (!openAIPayload.max_tokens) {
      const model = st.models?.data.find((m) => m.id === openAIPayload.model)
      if (model) {
        openAIPayload.max_tokens = model.capabilities.limits.max_output_tokens
      }
    }

    const enableVision = openAIPayload.messages.some(
      (x) =>
        typeof x.content !== "string"
        && Array.isArray(x.content)
        && x.content.some((p) => p.type === "image_url"),
    )

    const isAgentCall = openAIPayload.messages.some((msg) =>
      ["assistant", "tool"].includes(msg.role),
    )

    const headers: Record<string, string> = {
      ...copilotHeaders(st, enableVision),
      "X-Initiator": isAgentCall ? "agent" : "user",
    }

    const response = await fetch(`${copilotBaseUrl(st)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(openAIPayload),
    })

    if (!response.ok) {
      const text = await response.text()
      return c.json(
        { error: { message: text, type: "error" } },
        response.status as 400,
      )
    }

    if (openAIPayload.stream) {
      return streamSSE(c, async (stream) => {
        const streamState = {
          messageStartSent: false,
          contentBlockIndex: 0,
          contentBlockOpen: false,
          toolCalls: {} as Record<
            number,
            { id: string; name: string; anthropicBlockIndex: number }
          >,
        }

        const eventStream = events(response)
        for await (const rawEvent of eventStream) {
          if (rawEvent.data === "[DONE]") break
          if (!rawEvent.data) continue

          const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
          const translated = translateChunkToAnthropicEvents(chunk, streamState)
          for (const event of translated) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            })
          }
        }
      })
    }

    const openAIResponse = (await response.json()) as ChatCompletionResponse
    return c.json(translateToAnthropic(openAIResponse))
  } catch (error) {
    return c.json(
      { error: { message: (error as Error).message, type: "error" } },
      500,
    )
  }
}

export async function countTokensHandler(
  c: Context,
  st: State,
): Promise<Response> {
  try {
    const anthropicPayload =
      (c.get("bufferedBody") as AnthropicMessagesPayload | undefined)
      ?? (await c.req.json<AnthropicMessagesPayload>())
    const openAIPayload: ChatCompletionsPayload =
      translateToOpenAI(anthropicPayload)

    const selectedModel = st.models?.data.find(
      (m) => m.id === anthropicPayload.model,
    )
    if (!selectedModel) return c.json({ input_tokens: 1 })

    const tokenCount = await getTokenCount(openAIPayload, selectedModel)
    let finalTokenCount = tokenCount.input + tokenCount.output

    if (anthropicPayload.model.startsWith("claude")) {
      finalTokenCount = Math.round(finalTokenCount * 1.15)
    } else if (anthropicPayload.model.startsWith("grok")) {
      finalTokenCount = Math.round(finalTokenCount * 1.03)
    }

    return c.json({ input_tokens: finalTokenCount })
  } catch {
    return c.json({ input_tokens: 1 })
  }
}
