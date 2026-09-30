import { beforeEach, expect, mock, test } from "bun:test"
import { events } from "fetch-event-stream"

import type { Model } from "../src/services/copilot/get-models"

import { state } from "../src/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "../src/services/copilot/create-chat-completions"
import {
  chatPayloadToResponsesPayload,
  chatResultToResponsesResult,
  isResponsesOnlyModel,
  responsesPayloadToChatPayload,
  responsesResultToChatCompletion,
  streamChatAsResponsesEvents,
  streamResponsesAsChatChunks,
} from "../src/services/copilot/responses-adapter"

const responsesOnly: Model = {
  id: "gpt-5.3-codex",
  name: "GPT-5.3 Codex",
  object: "model",
  version: "1",
  vendor: "openai",
  preview: false,
  model_picker_enabled: true,
  supported_endpoints: ["/responses"],
}

const chatCapable: Model = {
  ...responsesOnly,
  id: "gpt-4o",
  supported_endpoints: ["/chat/completions", "/responses"],
}

state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

beforeEach(() => {
  state.models = { object: "list", data: [responsesOnly, chatCapable] }
  state.modelSession = {
    token: "test-session",
    availableModels: [],
    expiresAt: Date.now() + 60_000,
  }
})

test("isResponsesOnlyModel only flags responses-only models", () => {
  expect(isResponsesOnlyModel("gpt-5.3-codex")).toBe(true)
  expect(isResponsesOnlyModel("gpt-4o")).toBe(false)
  expect(isResponsesOnlyModel("unknown-model")).toBe(false)
})

test("chatPayloadToResponsesPayload converts instructions, tools and limits", () => {
  const result = chatPayloadToResponsesPayload({
    model: "gpt-5.3-codex",
    messages: [
      { role: "system", content: "Be terse" },
      { role: "user", content: "say hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "greet", arguments: "{}" },
          },
        ],
      },
      { role: "tool", content: "hello", tool_call_id: "call_1" },
    ],
    max_tokens: 42,
    tools: [
      {
        type: "function",
        function: { name: "greet", description: "d", parameters: {} },
      },
    ],
  })

  expect(result.instructions).toBe("Be terse")
  expect(result.max_output_tokens).toBe(42)
  expect(result.model).toBe("gpt-5.3-codex")

  const input = result.input as Array<Record<string, unknown>>
  expect(input[0]).toEqual({ role: "user", content: "say hi" })
  expect(input[1]).toEqual({
    type: "function_call",
    call_id: "call_1",
    name: "greet",
    arguments: "{}",
  })
  expect(input[2]).toEqual({
    type: "function_call_output",
    call_id: "call_1",
    output: "hello",
  })

  expect(result.tools).toEqual([
    { type: "function", name: "greet", description: "d", parameters: {} },
  ])
})

test("responsesResultToChatCompletion rebuilds text, tool calls and usage", () => {
  const result = responsesResultToChatCompletion(
    {
      id: "resp_1",
      created_at: 123,
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "hello world" }],
        },
        {
          type: "function_call",
          call_id: "call_9",
          name: "greet",
          arguments: "{}",
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
    "gpt-5.3-codex",
  )

  expect(result.object).toBe("chat.completion")
  expect(result.choices[0].message.content).toBe("hello world")
  expect(result.choices[0].message.tool_calls?.[0]?.function.name).toBe("greet")
  expect(result.choices[0].finish_reason).toBe("tool_calls")
  expect(result.usage?.prompt_tokens).toBe(10)
  expect(result.usage?.total_tokens).toBe(15)
})

const sseBody = (lines: Array<object>) =>
  lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")

test("streamResponsesAsChatChunks emits role, text and finish chunks", async () => {
  const body = sseBody([
    { type: "response.created", response: { id: "resp_9", created_at: 42 } },
    { type: "response.output_text.delta", delta: "PO" },
    { type: "response.output_text.delta", delta: "NG" },
    {
      type: "response.completed",
      response: {
        id: "resp_9",
        created_at: 42,
        output: [
          { type: "message", content: [{ type: "output_text", text: "PONG" }] },
        ],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      },
    },
  ])
  const upstream = new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })

  const chunks: Array<ChatCompletionChunk> = []
  let sawSentinel = false
  for await (const event of streamResponsesAsChatChunks(
    upstream,
    "gpt-5.3-codex",
    events,
  )) {
    if (!event.data.startsWith("{")) {
      sawSentinel = sawSentinel || event.data === "[DO" + "NE]"
      continue
    }
    chunks.push(JSON.parse(event.data) as ChatCompletionChunk)
  }
  expect(sawSentinel).toBe(true)

  expect(chunks[0].choices[0].delta.role).toBe("assistant")
  const text = chunks.map((c) => c.choices[0].delta.content ?? "").join("")
  expect(text).toBe("PONG")
  const last = chunks.at(-1)
  if (!last) throw new Error("expected to finish with a final chunk")
  expect(last.choices[0].finish_reason).toBe("stop")
  expect(last.usage?.total_tokens).toBe(6)
})

test("createChatCompletions translates responses-only models end to end", async () => {
  const upstream = new Response(
    JSON.stringify({
      id: "resp_5",
      created_at: 100,
      output: [
        { type: "message", content: [{ type: "output_text", text: "PONG" }] },
      ],
      usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
  const fetchMock = mock((_url: string, _opts?: unknown) => upstream)
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

  const result = (await createChatCompletions({
    model: "gpt-5.3-codex",
    messages: [{ role: "user", content: "hi" }],
  })) as ChatCompletionResponse

  expect(result.choices[0].message.content).toBe("PONG")
  expect(result.choices[0].finish_reason).toBe("stop")
  expect(result.usage?.prompt_tokens).toBe(3)
})

test("translates object tool_choice between both API shapes", () => {
  const toResponses = chatPayloadToResponsesPayload({
    model: "gpt-5.3-codex",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        type: "function",
        function: { name: "greet", description: "d", parameters: {} },
      },
    ],
    tool_choice: { type: "function", function: { name: "greet" } },
  })
  expect(toResponses.tool_choice).toEqual({ type: "function", name: "greet" })

  const toChat = responsesPayloadToChatPayload({
    model: "gpt-4.1",
    input: "hi",
    tools: [{ type: "function", name: "greet", parameters: {} }],
    tool_choice: { type: "function", name: "greet" },
  })
  expect(toChat.tool_choice).toEqual({
    type: "function",
    function: { name: "greet" },
  })
})

test("groups consecutive function_call items into one assistant message", () => {
  const payload = responsesPayloadToChatPayload({
    model: "gpt-4.1",
    input: [
      { role: "user", content: "run both" },
      { type: "function_call", call_id: "call_1", name: "a", arguments: "{}" },
      { type: "function_call", call_id: "call_2", name: "b", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "1" },
      { type: "function_call_output", call_id: "call_2", output: "2" },
    ],
  })

  expect(payload.messages).toEqual([
    { role: "user", content: "run both" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "a", arguments: "{}" },
        },
        {
          id: "call_2",
          type: "function",
          function: { name: "b", arguments: "{}" },
        },
      ],
    },
    { role: "tool", content: "1", tool_call_id: "call_1" },
    { role: "tool", content: "2", tool_call_id: "call_2" },
  ])
})

test("maps incomplete responses to finish_reason length", () => {
  const result = responsesResultToChatCompletion(
    {
      id: "resp_x",
      status: "incomplete",
      output: [
        { type: "message", content: [{ type: "output_text", text: "cut" }] },
      ],
    },
    "gpt-5.3-codex",
  )
  expect(result.choices[0].finish_reason).toBe("length")
})

test("skips non-function tools in reverse translation", () => {
  const payload = responsesPayloadToChatPayload({
    model: "gpt-4.1",
    input: "hi",
    tools: [
      { type: "web_search" },
      { type: "function", name: "greet", parameters: {} },
    ],
  })
  expect(payload.tools).toEqual([
    {
      type: "function",
      function: { name: "greet", description: undefined, parameters: {} },
    },
  ])

  const noFunctions = responsesPayloadToChatPayload({
    model: "gpt-4.1",
    input: "hi",
    tools: [{ type: "web_search" }],
  })
  expect(noFunctions.tools).toBeUndefined()
})

test("throws on failed responses results instead of faking success", () => {
  expect(() =>
    responsesResultToChatCompletion(
      { id: "resp_f", status: "failed", error: { message: "boom" } },
      "gpt-5.3-codex",
    ),
  ).toThrow("boom")
})

test("maps chat finish_reason length to responses status incomplete", () => {
  const result = chatResultToResponsesResult({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "gpt-4.1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "cut off" },
        logprobs: null,
        finish_reason: "length",
      },
    ],
  })
  expect(result.status).toBe("incomplete")
})

test("preserves usage from usage-only chat chunks", async () => {
  const chatChunks = [
    {
      data: JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4.1",
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      }),
    },
    {
      data: JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4.1",
        choices: [
          {
            index: 0,
            delta: { content: "hi" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      }),
    },
    {
      data: JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4.1",
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      }),
    },
  ]
  const body =
    chatChunks.map((e) => `data: ${e.data}\n\n`).join("") + `data: [DONE]\n\n`
  const upstream = new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })
  const collected: Array<Record<string, unknown>> = []
  for await (const event of streamChatAsResponsesEvents(
    events(upstream),
    "gpt-4.1",
  )) {
    collected.push(JSON.parse(event.data) as Record<string, unknown>)
  }
  const completed = collected.find((e) => e.type === "response.completed") as {
    response?: { usage?: { total_tokens?: number } }
  }
  expect(completed.response?.usage?.total_tokens).toBe(9)
})

test("rejects cancelled responses results", () => {
  expect(() =>
    responsesResultToChatCompletion(
      {
        status: "cancelled",
        error: { message: "Request was cancelled" },
      },
      "gpt-test",
    ),
  ).toThrow("Request was cancelled")

  expect(() =>
    responsesResultToChatCompletion({ status: "cancelled" }, "gpt-test"),
  ).toThrow("Responses request cancelled")
})

test("maps responses text.format json_object back to chat response_format", () => {
  const payload = responsesPayloadToChatPayload({
    model: "gpt-4.1",
    input: "hi",
    text: { format: { type: "json_object" } },
  })
  expect(payload.response_format).toEqual({ type: "json_object" })

  const plain = responsesPayloadToChatPayload({ model: "gpt-4.1", input: "hi" })
  expect(plain.response_format).toBeUndefined()
})
