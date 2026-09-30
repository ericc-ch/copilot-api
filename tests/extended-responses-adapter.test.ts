import { expect, test } from "bun:test"
import { events } from "fetch-event-stream"

import type { ChatCompletionChunk } from "../src/services/copilot/create-chat-completions"

import {
  chatPayloadToResponsesPayload,
  streamChatAsResponsesEvents,
} from "../src/services/copilot/responses-adapter"

const chatChunk = (delta: Record<string, unknown>, finish: string | null) => ({
  data: JSON.stringify({
    id: "c2",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4.1",
    choices: [
      { index: 0, delta, finish_reason: finish, logprobs: null },
    ] as Array<ChatCompletionChunk["choices"][number]>,
  }),
})

const streamFrom = (
  chunks: Array<{ data: string }>,
): AsyncIterable<{ data?: string | null }> => {
  const body =
    chunks.map((e) => `data: ${e.data}\n\n`).join("") + "data: [DO" + "NE]\n\n"
  return events(
    new Response(body, {
      headers: { "content-type": "text/event-stream" },
    }),
  )
}

const collect = async (
  chunks: Array<{ data: string }>,
): Promise<Array<Record<string, unknown>>> => {
  const out: Array<Record<string, unknown>> = []
  for await (const event of streamChatAsResponsesEvents(
    streamFrom(chunks),
    "gpt-4.1",
  )) {
    out.push(JSON.parse(event.data) as Record<string, unknown>)
  }
  return out
}

test("maps json response_format to responses text.format", () => {
  const payload = chatPayloadToResponsesPayload({
    model: "gpt-5.3-codex",
    messages: [{ role: "user", content: "hi" }],
    response_format: { type: "json_object" },
  })
  expect(payload["text"]).toEqual({ format: { type: "json_object" } })
})

test("emits response.incomplete terminal for a length-truncated stream", async () => {
  const out = await collect([
    chatChunk({ role: "assistant" }, null),
    chatChunk({ content: "cut" }, null),
    chatChunk({}, "length"),
  ])
  const terminal = out.at(-1) as {
    type?: string
    response?: {
      status?: string
      incomplete_details?: { reason?: string }
    }
  }
  expect(terminal.type).toBe("response.incomplete")
  expect(terminal.response?.status).toBe("incomplete")
  expect(terminal.response?.incomplete_details?.reason).toBe(
    "max_output_tokens",
  )
})

test("emits function-call item events before the terminal event", async () => {
  const out = await collect([
    chatChunk({ role: "assistant" }, null),
    chatChunk(
      {
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "greet", arguments: "" },
          },
        ],
      },
      null,
    ),
    chatChunk(
      {
        tool_calls: [{ index: 0, function: { arguments: '{"msg":"hi"}' } }],
      },
      null,
    ),
    chatChunk({}, "tool_calls"),
  ])

  const types = out.map((e) => e["type"])
  const terminalIndex = types.indexOf("response.completed")
  expect(terminalIndex).toBeGreaterThan(0)

  const added = out.find(
    (e) =>
      e["type"] === "response.output_item.added"
      && (e["item"] as { type?: string } | undefined)?.type === "function_call",
  )
  expect(added).toBeDefined()
  const addedIndex = out.indexOf(added as Record<string, unknown>)
  expect(addedIndex).toBeLessThan(terminalIndex)

  const delta = out.find(
    (e) => e["type"] === "response.function_call_arguments.delta",
  ) as { delta?: string } | undefined
  expect(delta?.delta).toBe('{"msg":"hi"}')

  const done = out.find(
    (e) => e["type"] === "response.function_call_arguments.done",
  ) as { arguments?: string } | undefined
  expect(done?.arguments).toBe('{"msg":"hi"}')

  const outDone = out.find(
    (e) =>
      e["type"] === "response.output_item.done"
      && (e["item"] as { type?: string } | undefined)?.type === "function_call",
  )
  expect(outDone).toBeDefined()

  const terminal = out[terminalIndex] as {
    response?: { status?: string; output?: Array<{ type?: string }> }
  }
  expect(terminal.response?.status).toBe("completed")
  expect(
    terminal.response?.output?.some((o) => o.type === "function_call"),
  ).toBe(true)
})
