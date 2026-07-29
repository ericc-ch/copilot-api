import { describe, expect, test } from "bun:test"

import {
  responseEventToChatChunks,
  responseToChatCompletion,
  shouldUseResponsesEndpoint,
  toResponsesPayload,
  type ResponseApiResponse,
  type ResponsesStreamState,
} from "~/services/copilot/create-responses"

describe("Responses API adapter", () => {
  test("uses responses only for models that do not support chat completions", () => {
    expect(shouldUseResponsesEndpoint(["/responses"])).toBe(true)
    expect(
      shouldUseResponsesEndpoint(["/responses", "/chat/completions"]),
    ).toBe(false)
    expect(shouldUseResponsesEndpoint(["/chat/completions"])).toBe(false)
    expect(shouldUseResponsesEndpoint()).toBe(false)
  })

  test("converts a non-streaming response to a chat completion", () => {
    const response: ResponseApiResponse = {
      id: "resp_123",
      object: "response",
      created_at: 1700000000,
      model: "gpt-test",
      status: "completed",
      output: [
        {
          content: [
            { type: "output_text", text: "Hello" },
            { type: "output_text", text: " there" },
          ],
        },
      ],
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        total_tokens: 5,
      },
    }

    const chatCompletion = responseToChatCompletion(response)

    expect(chatCompletion.id).toBe("resp_123")
    expect(chatCompletion.object).toBe("chat.completion")
    expect(chatCompletion.choices[0].message.content).toBe("Hello there")
    expect(chatCompletion.choices[0].finish_reason).toBe("stop")
    expect(chatCompletion.usage).toEqual({
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    })
  })

  test("converts response stream events to chat completion chunks", () => {
    const streamState: ResponsesStreamState = {
      id: "",
      model: "gpt-test",
      created: 0,
      roleSent: false,
    }

    expect(
      responseEventToChatChunks(
        JSON.stringify({
          type: "response.created",
          response: {
            id: "resp_123",
            object: "response",
            created_at: 1700000000,
            model: "gpt-test",
            status: "in_progress",
          },
        }),
        streamState,
      ),
    ).toEqual([])

    const deltaChunks = responseEventToChatChunks(
      JSON.stringify({
        type: "response.output_text.delta",
        delta: "Hello",
      }),
      streamState,
    )

    expect(deltaChunks).toHaveLength(1)
    expect(deltaChunks[0]).toMatchObject({
      id: "resp_123",
      object: "chat.completion.chunk",
      choices: [
        {
          delta: {
            role: "assistant",
            content: "Hello",
          },
          finish_reason: null,
        },
      ],
    })

    const completedChunks = responseEventToChatChunks(
      JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_123",
          object: "response",
          created_at: 1700000000,
          model: "gpt-test",
          status: "completed",
          usage: {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5,
          },
        },
      }),
      streamState,
    )

    expect(completedChunks.at(-1)).toBe("[DONE]")
    expect(completedChunks[0]).toMatchObject({
      choices: [
        {
          delta: {
            content: null,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
      },
    })
  })

  test("skips malformed stream events instead of throwing", () => {
    const streamState: ResponsesStreamState = {
      id: "resp_123",
      model: "gpt-test",
      created: 1700000000,
      roleSent: true,
    }

    expect(responseEventToChatChunks("not json {", streamState)).toEqual([])
    expect(responseEventToChatChunks("[DONE]", streamState)).toEqual([])
    expect(responseEventToChatChunks("", streamState)).toEqual([])

    // Stream state must be untouched so later valid events still work
    const deltaChunks = responseEventToChatChunks(
      JSON.stringify({ type: "response.output_text.delta", delta: "Hi" }),
      streamState,
    )
    expect(deltaChunks).toHaveLength(1)
  })

  test("ignores unknown event types", () => {
    const streamState: ResponsesStreamState = {
      id: "resp_123",
      model: "gpt-test",
      created: 1700000000,
      roleSent: false,
    }

    expect(
      responseEventToChatChunks(
        JSON.stringify({ type: "response.output_item.added" }),
        streamState,
      ),
    ).toEqual([])
    expect(streamState.roleSent).toBe(false)
  })
})

describe("Responses API tool forwarding", () => {
  test("flattens chat-completions tools into responses function tools", () => {
    const payload = toResponsesPayload({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: {} } },
          },
        },
      ],
    }) as unknown as {
      tools?: Array<Record<string, unknown>>
    }

    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: { city: {} } },
      },
    ])
  })

  test("maps tool_choice variants", () => {
    const auto = toResponsesPayload({
      model: "m",
      messages: [],
      tool_choice: "auto",
    }) as unknown as { tool_choice?: unknown }
    expect(auto.tool_choice).toBe("auto")

    const forced = toResponsesPayload({
      model: "m",
      messages: [],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    }) as unknown as { tool_choice?: unknown }
    expect(forced.tool_choice).toEqual({
      type: "function",
      name: "get_weather",
    })

    const none = toResponsesPayload({
      model: "m",
      messages: [],
    }) as unknown as { tool_choice?: unknown }
    expect(none.tool_choice).toBeUndefined()
  })

  test("converts assistant tool_calls and tool results into input items", () => {
    const payload = toResponsesPayload({
      model: "m",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"city":"Boston"}',
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "Sunny" },
      ],
    }) as unknown as { input: Array<Record<string, unknown>> }

    expect(payload.input).toEqual([
      { type: "message", role: "user", content: "weather?" },
      { type: "message", role: "assistant", content: "Let me check." },
      {
        type: "function_call",
        call_id: "call_1",
        name: "get_weather",
        arguments: '{"city":"Boston"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "Sunny" },
    ])
  })

  test("omits assistant text when the turn is purely a tool call", () => {
    const payload = toResponsesPayload({
      model: "m",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_9",
              type: "function",
              function: { name: "noop", arguments: "{}" },
            },
          ],
        },
      ],
    }) as unknown as { input: Array<Record<string, unknown>> }

    expect(payload.input).toEqual([
      {
        type: "function_call",
        call_id: "call_9",
        name: "noop",
        arguments: "{}",
      },
    ])
  })
})

describe("Responses API tool forwarding (responses)", () => {
  test("converts a non-streaming function_call output into tool_calls", () => {
    const response: ResponseApiResponse = {
      id: "resp_1",
      object: "response",
      created_at: 1700000000,
      model: "gpt-test",
      status: "completed",
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "get_weather",
          arguments: '{"city":"Boston"}',
        },
      ],
    }

    const chat = responseToChatCompletion(response)
    expect(chat.choices[0].finish_reason).toBe("tool_calls")
    expect(chat.choices[0].message.content).toBeNull()
    expect(chat.choices[0].message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Boston"}' },
      },
    ])
  })

  test("streams a function call as opening + argument chunks", () => {
    const streamState: ResponsesStreamState = {
      id: "resp_1",
      model: "gpt-test",
      created: 1700000000,
      roleSent: false,
    }

    const openChunks = responseEventToChatChunks(
      JSON.stringify({
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "get_weather",
          arguments: "",
        },
      }),
      streamState,
    )

    expect(openChunks).toHaveLength(1)
    expect(openChunks[0]).toMatchObject({
      choices: [
        {
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })

    const argChunks = responseEventToChatChunks(
      JSON.stringify({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        delta: '{"city":',
      }),
      streamState,
    )
    expect(argChunks).toHaveLength(1)
    expect(argChunks[0]).toMatchObject({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
          },
        },
      ],
    })

    const completed = responseEventToChatChunks(
      JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_1",
          object: "response",
          created_at: 1700000000,
          model: "gpt-test",
          status: "completed",
        },
      }),
      streamState,
    )
    expect(completed[0]).toMatchObject({
      choices: [{ finish_reason: "tool_calls" }],
    })
    expect(completed.at(-1)).toBe("[DONE]")
  })

  test("ignores argument deltas for unknown function-call item ids", () => {
    const streamState: ResponsesStreamState = {
      id: "resp_1",
      model: "gpt-test",
      created: 1700000000,
      roleSent: true,
    }

    expect(
      responseEventToChatChunks(
        JSON.stringify({
          type: "response.function_call_arguments.delta",
          item_id: "unknown",
          delta: "{}",
        }),
        streamState,
      ),
    ).toEqual([])
  })

  test("assigns increasing indices to parallel function calls", () => {
    const streamState: ResponsesStreamState = {
      id: "resp_1",
      model: "gpt-test",
      created: 1700000000,
      roleSent: false,
    }

    responseEventToChatChunks(
      JSON.stringify({
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "c1", name: "a" },
      }),
      streamState,
    )
    const second = responseEventToChatChunks(
      JSON.stringify({
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_2", call_id: "c2", name: "b" },
      }),
      streamState,
    )

    expect(second[0]).toMatchObject({
      choices: [{ delta: { tool_calls: [{ index: 1, id: "c2" }] } }],
    })
  })
})
