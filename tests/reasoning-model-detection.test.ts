import { test, expect } from "bun:test"

import { requiresMaxCompletionTokens } from "../src/routes/chat-completions/handler"

// OpenAI reasoning-model families (o1, o3, o4, gpt-5.x) reject
// `max_tokens` at API validation and require `max_completion_tokens`.
// These tests pin the detection regex.

test("requiresMaxCompletionTokens: matches known reasoning-model IDs", () => {
  const reasoningIds = [
    "gpt-5",
    "gpt-5.4",
    "gpt-5-mini",
    "gpt-5.1-preview",
    "o1",
    "o1-mini",
    "o1-preview",
    "o3",
    "o3-mini",
    "o4",
    "o4-mini",
  ]
  for (const id of reasoningIds) {
    expect(requiresMaxCompletionTokens(id)).toBe(true)
  }
})

test("requiresMaxCompletionTokens: does not match non-reasoning IDs", () => {
  const nonReasoningIds = [
    "gpt-4",
    "gpt-4-0613",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-3.5-turbo",
    "claude-opus-4.6",
    "claude-haiku-4.5",
    "claude-sonnet-4.6",
    "gemini-3.1-pro-preview",
    "text-embedding-3-small",
    "chatgpt-5-latest", // doesn't anchor to "gpt-5"
    "og1-foo", // starts with "og", not "o1"
  ]
  for (const id of nonReasoningIds) {
    expect(requiresMaxCompletionTokens(id)).toBe(false)
  }
})

test("requiresMaxCompletionTokens: handles undefined safely", () => {
  expect(requiresMaxCompletionTokens(undefined)).toBe(false)
})
