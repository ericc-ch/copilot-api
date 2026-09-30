import { expect, test } from "bun:test"

import type { ChatCompletionResponse } from "../src/services/copilot/create-chat-completions"

import {
  chatResultToCompletionResult,
  completionPayloadToChatPayload,
} from "../src/services/copilot/completions-adapter"

const chatResult = (
  overrides: Partial<ChatCompletionResponse> = {},
): ChatCompletionResponse => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 123,
  model: "gpt-4.1",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "one" },
      logprobs: null,
      finish_reason: "stop",
    },
    {
      index: 1,
      message: { role: "assistant", content: "two" },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  ...overrides,
})

test("forwards n and maps every choice with its original index", () => {
  const chatPayload = completionPayloadToChatPayload({
    model: "gpt-4.1",
    prompt: "hi",
    n: 2,
  })
  expect(chatPayload.n).toBe(2)

  const result = chatResultToCompletionResult(chatResult())
  expect(result.choices).toEqual([
    { text: "one", index: 0, finish_reason: "stop", logprobs: null },
    { text: "two", index: 1, finish_reason: "stop", logprobs: null },
  ])
})

test("carries usage into legacy completion results", () => {
  const result = chatResultToCompletionResult(chatResult())
  expect(result.usage).toEqual({
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
  })
})

test("rejects array prompts for chat translation", () => {
  expect(() =>
    completionPayloadToChatPayload({
      model: "gpt-4.1",
      prompt: ["first", "second"],
    }),
  ).toThrow("string prompt")
})
