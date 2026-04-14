import type { Context } from "hono"

import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { AnthropicMessagesPayload } from "../src/routes/messages/anthropic-types"
import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { handleCompletion } from "../src/routes/messages/handler"

const fetchMock = mock(
  (_url: string, opts: { body?: string | ReadableStream | null }) => {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "chatcmpl-test",
          object: "chat.completion" as const,
          created: 1,
          model: "mock-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "ok",
              },
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
          },
        }),
      body: opts.body,
    })
  },
)

const awaitApprovalMock = mock(() => Promise.resolve())
const checkRateLimitMock = mock(() => Promise.resolve())
const debugMock = mock(() => {})
const infoMock = mock(() => {})
const warnMock = mock(() => {})

// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

void mock.module("../src/lib/approval", () => ({
  awaitApproval: awaitApprovalMock,
}))

void mock.module("../src/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}))

void mock.module("consola", () => ({
  default: {
    debug: debugMock,
    info: infoMock,
    warn: warnMock,
  },
}))

function createContext(payload: AnthropicMessagesPayload): Context {
  return {
    req: {
      json: () => Promise.resolve(payload),
    },
    json: (body: unknown) => body,
  } as unknown as Context
}

function getLastRequestBody(): ChatCompletionsPayload {
  const lastCall = fetchMock.mock.calls.at(-1)
  expect(lastCall).toBeDefined()
  if (!lastCall) throw new Error("Expected fetch to be called")
  const options = lastCall[1] as { body: string }
  return JSON.parse(options.body) as ChatCompletionsPayload
}

function setModel(
  id: string,
  supports: {
    adaptive_thinking?: boolean
    reasoning_effort?: Array<string>
  },
) {
  state.models = {
    object: "list",
    data: [
      {
        id,
        name: id,
        object: "model",
        model_picker_enabled: true,
        preview: false,
        vendor: "test",
        version: "1",
        capabilities: {
          family: id,
          object: "model_capabilities",
          tokenizer: "test",
          type: "chat",
          supports,
          limits: {},
        },
      },
    ],
  }
}

describe("Anthropic messages handler reasoning translation", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    awaitApprovalMock.mockClear()
    checkRateLimitMock.mockClear()
    debugMock.mockClear()
    infoMock.mockClear()
    warnMock.mockClear()
    state.manualApprove = false
    state.copilotToken = "test-token"
    state.vsCodeVersion = "1.0.0"
    state.accountType = "individual"
  })

  test("claude-style model forwards reasoning_effort and thinking_budget", async () => {
    setModel("claude-sonnet-4.6", {
      adaptive_thinking: true,
      reasoning_effort: ["low", "medium", "high"],
    })

    await handleCompletion(
      createContext({
        model: "claude-sonnet-4.6",
        max_tokens: 256,
        thinking: { type: "enabled", budget_tokens: 2048 },
        messages: [{ role: "user", content: "Think carefully." }],
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBe("high")
    expect(body.thinking_budget).toBe(2048)
  })

  test("reasoning_effort-only model forwards reasoning_effort and drops thinking_budget", async () => {
    setModel("gpt-5-mini", {
      reasoning_effort: ["low", "medium", "high"],
    })

    await handleCompletion(
      createContext({
        model: "gpt-5-mini",
        max_tokens: 256,
        thinking: { type: "enabled", budget_tokens: 2048 },
        messages: [{ role: "user", content: "Think carefully." }],
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBe("high")
    expect(body.thinking_budget).toBeUndefined()
  })

  test("disabled thinking never forwards reasoning fields", async () => {
    setModel("claude-sonnet-4.6", {
      adaptive_thinking: true,
      reasoning_effort: ["low", "medium", "high"],
    })

    await handleCompletion(
      createContext({
        model: "claude-sonnet-4.6",
        max_tokens: 256,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: "Answer directly." }],
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking_budget).toBeUndefined()
  })

  test("unsupported model strips thinking config and logs debug", async () => {
    setModel("gpt-4o", {})

    await handleCompletion(
      createContext({
        model: "gpt-4o",
        max_tokens: 256,
        thinking: { type: "enabled", budget_tokens: 2048 },
        messages: [{ role: "user", content: "Think carefully." }],
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking_budget).toBeUndefined()
    expect(debugMock).toHaveBeenCalledWith(
      "Stripping unsupported Anthropic thinking config for model:",
      "gpt-4o",
    )
  })
})
