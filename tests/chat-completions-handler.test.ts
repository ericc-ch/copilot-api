import type { Context } from "hono"

import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { handleCompletion } from "../src/routes/chat-completions/handler"

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
          choices: [],
        }),
      body: opts.body,
    })
  },
)

const awaitApprovalMock = mock(() => Promise.resolve())
const checkRateLimitMock = mock(() => Promise.resolve())
const getTokenCountMock = mock(() => Promise.resolve(123))
const streamSSEMock = mock(() => Promise.resolve(new Response("stream")))
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

void mock.module("../src/lib/tokenizer", () => ({
  getTokenCount: getTokenCountMock,
}))

void mock.module("hono/streaming", () => ({
  streamSSE: streamSSEMock,
}))

void mock.module("consola", () => ({
  default: {
    debug: debugMock,
    info: infoMock,
    warn: warnMock,
  },
}))

function createContext(payload: ChatCompletionsPayload): Context {
  return {
    req: {
      json: () => Promise.resolve(payload),
    },
    json: (body: unknown) => body,
  } as unknown as Context
}

function getLastRequestBody() {
  const lastCall = fetchMock.mock.calls.at(-1)
  expect(lastCall).toBeDefined()

  if (!lastCall) {
    throw new Error("Expected fetch to be called")
  }

  const options = lastCall[1] as { body: string }
  return JSON.parse(options.body) as ChatCompletionsPayload
}

describe("handleCompletion reasoning normalization", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    awaitApprovalMock.mockClear()
    checkRateLimitMock.mockClear()
    getTokenCountMock.mockClear()
    streamSSEMock.mockClear()
    debugMock.mockClear()
    infoMock.mockClear()
    warnMock.mockClear()

    state.manualApprove = false
    state.copilotToken = "test-token"
    state.vsCodeVersion = "1.0.0"
    state.accountType = "individual"
    state.models = {
      object: "list",
      data: [],
    }
  })

  test("adaptive Claude model keeps reasoning_effort, thinking_budget, stream_options", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "claude-adaptive",
          name: "Claude Adaptive",
          object: "model",
          model_picker_enabled: true,
          preview: false,
          vendor: "anthropic",
          version: "1",
          capabilities: {
            family: "claude",
            object: "model_capabilities",
            tokenizer: "claude",
            type: "chat",
            supports: {
              adaptive_thinking: true,
              reasoning_effort: ["low", "medium", "high"],
            },
            limits: {
              max_output_tokens: 8192,
            },
          },
        },
      ],
    }

    const payload = {
      messages: [{ role: "user", content: "hello" }],
      model: "claude-adaptive",
      reasoning_effort: "high",
      thinking_budget: 2048,
      stream_options: { include_usage: true },
    } satisfies ChatCompletionsPayload

    await handleCompletion(createContext(payload))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLastRequestBody()).toMatchObject({
      reasoning_effort: "high",
      thinking_budget: 2048,
      stream_options: { include_usage: true },
      max_tokens: 8192,
    })
  })

  test("non-Claude adaptive model keeps thinking_budget", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-adaptive",
          name: "GPT Adaptive",
          object: "model",
          model_picker_enabled: true,
          preview: false,
          vendor: "openai",
          version: "1",
          capabilities: {
            family: "gpt",
            object: "model_capabilities",
            tokenizer: "gpt",
            type: "chat",
            supports: {
              adaptive_thinking: true,
              reasoning_effort: ["low", "medium", "high"],
            },
            limits: {
              max_output_tokens: 4096,
            },
          },
        },
      ],
    }

    const payload = {
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-adaptive",
      reasoning_effort: "medium",
      thinking_budget: 1024,
      stream_options: { include_usage: true },
    } satisfies ChatCompletionsPayload

    await handleCompletion(createContext(payload))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLastRequestBody()).toMatchObject({
      reasoning_effort: "medium",
      thinking_budget: 1024,
      stream_options: { include_usage: true },
      max_tokens: 4096,
    })
    expect(debugMock).not.toHaveBeenCalledWith(
      "Dropping unsupported OpenAI thinking_budget for model:",
      "gpt-adaptive",
    )
  })

  test("reasoning_effort-only model keeps reasoning_effort and drops thinking_budget", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-reasoning",
          name: "GPT Reasoning",
          object: "model",
          model_picker_enabled: true,
          preview: false,
          vendor: "openai",
          version: "1",
          capabilities: {
            family: "gpt",
            object: "model_capabilities",
            tokenizer: "gpt",
            type: "chat",
            supports: {
              reasoning_effort: ["low", "medium", "high"],
            },
            limits: {
              max_output_tokens: 4096,
            },
          },
        },
      ],
    }

    const payload = {
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-reasoning",
      reasoning_effort: "high",
      thinking_budget: 2048,
    } satisfies ChatCompletionsPayload

    await handleCompletion(createContext(payload))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBe("high")
    expect(body.thinking_budget).toBeUndefined()
    expect(debugMock).toHaveBeenCalledWith(
      "Dropping unsupported OpenAI thinking_budget for model:",
      "gpt-reasoning",
    )
  })

  test("plain model without reasoning capabilities drops both fields", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-4o",
          name: "GPT-4o",
          object: "model",
          model_picker_enabled: true,
          preview: false,
          vendor: "openai",
          version: "1",
          capabilities: {
            family: "gpt",
            object: "model_capabilities",
            tokenizer: "gpt",
            type: "chat",
            supports: {},
            limits: {
              max_output_tokens: 4096,
            },
          },
        },
      ],
    }

    const payload = {
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
      reasoning_effort: "high",
      thinking_budget: 2048,
    } satisfies ChatCompletionsPayload

    await handleCompletion(createContext(payload))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = getLastRequestBody()
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking_budget).toBeUndefined()
  })
})
