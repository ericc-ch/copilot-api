import { describe, expect, test } from "bun:test"

import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
} from "~/routes/messages/responses-stream-translation"

describe("Responses to Anthropic stream translation", () => {
  test("streams signed reasoning, text, and completion usage", () => {
    const state = createResponsesStreamState()
    const events = [
      ...translateResponsesStreamEvent(
        {
          type: "response.created",
          response: {
            id: "resp_1",
            object: "response",
            model: "gpt-5.6-terra",
            status: "in_progress",
            output: [],
          },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "reason_1" },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          delta: "Checking sources.",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "reasoning",
            id: "reason_1",
            encrypted_content: "opaque",
            summary: [{ type: "summary_text", text: "Checking sources." }],
          },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.delta",
          output_index: 1,
          content_index: 0,
          delta: "Answer",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.done",
          output_index: 1,
          content_index: 0,
          text: "Answer",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            object: "response",
            model: "gpt-5.6-terra",
            status: "completed",
            output: [],
            usage: {
              input_tokens: 40,
              output_tokens: 12,
            },
          },
        },
        state,
      ),
    ]

    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "signature_delta",
        signature: "opaque@reason_1",
      },
    })
    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "text_delta",
        text: "Answer",
      },
    })
    expect(events.at(-2)).toEqual({
      type: "message_delta",
      delta: {
        stop_reason: "end_turn",
        stop_sequence: null,
      },
      usage: {
        input_tokens: 40,
        output_tokens: 12,
      },
    })
    expect(events.at(-1)).toEqual({ type: "message_stop" })
  })

  test("streams function call arguments as a tool block", () => {
    const state = createResponsesStreamState()

    const events = [
      ...translateResponsesStreamEvent(
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            id: "item_1",
            call_id: "call_1",
            name: "search",
            arguments: "",
          },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: '{"query":',
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: '"news"}',
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.done",
          output_index: 0,
          arguments: '{"query":"news"}',
        },
        state,
      ),
    ]

    expect(events).toContainEqual({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "call_1",
        name: "search",
        input: {},
      },
    })
    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: '{"query":',
      },
    })
    expect(events.at(-1)).toEqual({
      type: "content_block_stop",
      index: 0,
    })
  })
})

describe("Responses stream block identity and server tools", () => {
  test("text parts with distinct content_index get separate blocks", () => {
    const state = createResponsesStreamState()

    const events = [
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          delta: "First part.",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.done",
          output_index: 0,
          content_index: 0,
          text: "First part.",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 1,
          delta: "Second part.",
        },
        state,
      ),
    ]

    // No delta may target a block that already stopped
    const stopped = new Set<number>()
    for (const event of events) {
      if (event.type === "content_block_stop") stopped.add(event.index)
      if (event.type === "content_block_delta") {
        expect(stopped.has(event.index)).toBe(false)
      }
    }

    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Second part." },
    })
  })

  test("separates reasoning summary parts like the non-stream join", () => {
    const state = createResponsesStreamState()

    const events = [
      ...translateResponsesStreamEvent(
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          summary_index: 0,
          delta: "Part one.",
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          summary_index: 1,
          delta: "Part two.",
        },
        state,
      ),
    ]

    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "\n\nPart two." },
    })
  })

  test("surfaces web search calls as server tool blocks", () => {
    const state = createResponsesStreamState()

    const events = [
      ...translateResponsesStreamEvent(
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "web_search_call", id: "ws_1", status: "in_progress" },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: {
              type: "search",
              query: "bun idle timeout",
              sources: [{ url: "https://example.com", title: "Example" }],
            },
          },
        },
        state,
      ),
      ...translateResponsesStreamEvent(
        {
          type: "response.output_text.delta",
          output_index: 1,
          content_index: 0,
          delta: "According to Example...",
        },
        state,
      ),
    ]

    expect(events).toContainEqual({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "server_tool_use",
        id: "ws_1",
        name: "web_search",
        input: {},
      },
    })
    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: '{"query":"bun idle timeout"}',
      },
    })
    expect(events).toContainEqual({
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "ws_1",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com",
            title: "Example",
            page_age: null,
            encrypted_content: "",
          },
        ],
      },
    })
    // Text after the search lands in its own block
    expect(events).toContainEqual({
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: "According to Example..." },
    })
  })
})
