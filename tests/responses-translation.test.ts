import { describe, test, expect } from "bun:test"

import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"
import type { ResponsesResponse } from "~/services/copilot/create-responses"

import {
  createResponsesStreamState,
  translateChatToResponses,
  translateResponsesEventToChatChunks,
  translateResponsesToChat,
} from "~/routes/responses/translation"

describe("Chat -> Responses Translation", () => {
  test("maps system instructions, tool calls, and tool results", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.2-codex",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"loc":"SF"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "Sunny" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object" },
          },
        },
      ],
      max_tokens: 123,
      reasoning_effort: "high",
      stream: true,
    }

    const translated = translateChatToResponses(payload)

    expect(translated.instructions).toBe("You are helpful.")
    expect(Array.isArray(translated.input)).toBe(true)

    const input = translated.input as Array<{
      role: string
      content: Array<{ type: string }>
    }>
    expect(input[0]?.role).toBe("user")
    expect(input[1]?.content.some((part) => part.type === "tool_call")).toBe(
      true,
    )
    expect(input[2]?.content[0]).toMatchObject({
      type: "tool_result",
      tool_call_id: "call_1",
      output: "Sunny",
    })
    expect(translated.max_output_tokens).toBe(123)
    expect(translated.reasoning?.effort).toBe("high")
  })
})

describe("Responses -> Chat Translation", () => {
  test("maps output text and function calls", () => {
    const response: ResponsesResponse = {
      id: "resp_123",
      object: "response",
      model: "gpt-test",
      output: [
        { type: "output_text", text: "Hello " },
        { type: "output_text", text: "world" },
        {
          type: "function_call",
          id: "call_2",
          name: "lookup",
          arguments: '{"q":"hi"}',
        },
      ],
      usage: { input_tokens: 3, output_tokens: 5 },
    }

    const translated = translateResponsesToChat(response)

    expect(translated.choices[0]?.message.content).toBe("Hello world")
    expect(translated.choices[0]?.message.tool_calls?.[0]?.function.name).toBe(
      "lookup",
    )
    expect(translated.choices[0]?.finish_reason).toBe("tool_calls")
  })
})

describe("Responses Stream -> Chat Chunks", () => {
  test("translates tool call and text deltas", () => {
    const state = createResponsesStreamState("gpt-test")

    const startChunks = translateResponsesEventToChatChunks(
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "call_stream",
          name: "do_thing",
          arguments: "",
        },
      },
      "response.output_item.added",
      state,
    )

    const toolDeltaChunks = translateResponsesEventToChatChunks(
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: '{"a"',
      },
      "response.function_call_arguments.delta",
      state,
    )

    const textChunks = translateResponsesEventToChatChunks(
      { type: "response.output_text.delta", delta: "Hello" },
      "response.output_text.delta",
      state,
    )

    const endChunks = translateResponsesEventToChatChunks(
      {
        type: "response.completed",
        response: {
          id: "resp_done",
          object: "response",
          model: "gpt-test",
          output: [],
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      },
      "response.completed",
      state,
    )

    expect(
      startChunks.some((chunk) =>
        chunk.choices[0]?.delta.tool_calls?.some(
          (call) => call.id === "call_stream",
        ),
      ),
    ).toBe(true)
    expect(
      toolDeltaChunks.some((chunk) =>
        chunk.choices[0]?.delta.tool_calls?.some(
          (call) => call.function?.arguments === '{"a"',
        ),
      ),
    ).toBe(true)
    expect(
      textChunks.some((chunk) => chunk.choices[0]?.delta.content === "Hello"),
    ).toBe(true)
    expect(endChunks[0]?.choices[0]?.finish_reason).toBe("tool_calls")
  })
})
