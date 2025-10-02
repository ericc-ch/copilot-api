import { describe, it, expect } from "bun:test"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { translateOpenAIToGemini } from "~/routes/generate-content/translation"

describe("OpenAI to Gemini Response Translation", () => {
  it("should handle assistant message with tool calls having arguments", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "I'll search for that",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query": "test query", "limit": 10}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    }

    const result = translateOpenAIToGemini(openAIResponse)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.content.parts).toHaveLength(2)
    expect(result.candidates[0]?.content.parts[0]).toEqual({
      text: "I'll search for that",
    })
    expect(result.candidates[0]?.content.parts[1]).toEqual({
      functionCall: {
        name: "search",
        args: { query: "test query", limit: 10 },
      },
    })
  })

  it("should handle assistant message with tool calls having empty arguments", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-456",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Getting current time",
            tool_calls: [
              {
                id: "call_456",
                type: "function",
                function: {
                  name: "get_current_time",
                  arguments: "",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 10,
        total_tokens: 15,
      },
    }

    const result = translateOpenAIToGemini(openAIResponse)

    expect(result.candidates[0]?.content.parts[1]).toEqual({
      functionCall: {
        name: "get_current_time",
        args: {},
      },
    })
  })

  it("should handle assistant message with simple text content", () => {
    const openAIResponse: ChatCompletionResponse = {
      id: "chatcmpl-789",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Here's my response",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 5,
        total_tokens: 20,
      },
    }

    const result = translateOpenAIToGemini(openAIResponse)

    expect(result.candidates[0]?.content.parts).toHaveLength(1)
    expect(result.candidates[0]?.content.parts[0]).toEqual({
      text: "Here's my response",
    })
  })
})
