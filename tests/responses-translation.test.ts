import { describe, expect, test } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type { ResponsesResult } from "~/services/copilot/create-responses"

import {
  translateAnthropicToResponses,
  translateResponsesToAnthropic,
} from "~/routes/messages/responses-translation"

describe("Anthropic to Responses translation", () => {
  test("preserves system context, assistant prefill, tools, and effort", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-5.6-terra",
      system: [
        { type: "text", text: "System one." },
        { type: "text", text: "System two." },
      ],
      messages: [
        { role: "user", content: "Find the answer." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will search." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "search",
              input: { query: "answer" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "Search result",
            },
            { type: "text", text: "Continue." },
          ],
        },
        { role: "assistant", content: "PREFIX:" },
      ],
      max_tokens: 4096,
      output_config: { effort: "max" },
      tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
          allowed_domains: ["example.com"],
          user_location: {
            type: "approximate",
            country: "US",
            timezone: "America/Los_Angeles",
          },
        },
      ],
      tool_choice: { type: "auto" },
      stream: true,
    }

    const translated = translateAnthropicToResponses(payload)

    expect(translated).toMatchObject({
      model: "gpt-5.6-terra",
      instructions: "System one.\n\nSystem two.",
      max_output_tokens: 4096,
      stream: true,
      store: false,
      reasoning: {
        effort: "max",
        summary: "auto",
      },
      tool_choice: "auto",
      include: [
        "reasoning.encrypted_content",
        "web_search_call.action.sources",
      ],
    })
    expect(translated.tools).toEqual([
      {
        type: "function",
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        strict: false,
      },
      {
        type: "web_search",
        filters: {
          allowed_domains: ["example.com"],
        },
        user_location: {
          type: "approximate",
          country: "US",
          timezone: "America/Los_Angeles",
        },
      },
    ])
    expect(translated.input).toEqual([
      {
        type: "message",
        role: "user",
        content: "Find the answer.",
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "I will search." }],
      },
      {
        type: "function_call",
        call_id: "tool_1",
        name: "search",
        arguments: '{"query":"answer"}',
        status: "completed",
      },
      {
        type: "function_call_output",
        call_id: "tool_1",
        output: "Search result",
        status: "completed",
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue." }],
      },
      {
        type: "message",
        role: "assistant",
        content: "PREFIX:",
      },
    ])
  })

  test("rejects web search exclusions that Responses cannot enforce", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-5.6-terra",
      messages: [{ role: "user", content: "Search." }],
      max_tokens: 1024,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          blocked_domains: ["example.com"],
        },
      ],
    }

    expect(() => translateAnthropicToResponses(payload)).toThrow(
      "Copilot Responses web search does not support blocked_domains",
    )
  })

  test("does not invent a reasoning effort", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-5.6-terra",
      messages: [{ role: "user", content: "Answer directly." }],
      max_tokens: 1024,
    }

    expect(translateAnthropicToResponses(payload).reasoning).toBeUndefined()
    // No web search tool -> no sources include
    expect(translateAnthropicToResponses(payload).include).toEqual([
      "reasoning.encrypted_content",
    ])
  })

  test("preserves an explicit no-reasoning effort", () => {
    const payload: AnthropicMessagesPayload = {
      model: "gpt-5.6-terra",
      messages: [{ role: "user", content: "Answer directly." }],
      max_tokens: 1024,
      output_config: { effort: "none" },
    }

    expect(translateAnthropicToResponses(payload).reasoning).toEqual({
      effort: "none",
      summary: "auto",
    })
  })
})

describe("Responses to Anthropic translation", () => {
  test("round-trips encrypted reasoning and tool calls", () => {
    const response: ResponsesResult = {
      id: "resp_1",
      object: "response",
      model: "gpt-5.6-terra",
      status: "completed",
      output: [
        {
          id: "reason_1",
          type: "reasoning",
          encrypted_content: "opaque",
          summary: [{ type: "summary_text", text: "I should search." }],
        },
        {
          id: "call_item_1",
          type: "function_call",
          call_id: "call_1",
          name: "search",
          arguments: '{"query":"latest"}',
          status: "completed",
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        input_tokens_details: {
          cached_tokens: 20,
          cache_write_tokens: 10,
        },
      },
    }

    expect(translateResponsesToAnthropic(response)).toEqual({
      id: "resp_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "I should search.",
          signature: "opaque@reason_1",
        },
        {
          type: "tool_use",
          id: "call_1",
          name: "search",
          input: { query: "latest" },
        },
      ],
      model: "gpt-5.6-terra",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 90,
        output_tokens: 30,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
    })
  })

  test("translates web search calls into server tool blocks", () => {
    const response: ResponsesResult = {
      id: "resp_2",
      object: "response",
      model: "gpt-5.6-terra",
      status: "completed",
      output: [
        {
          id: "ws_1",
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "weather boston",
            sources: [
              { url: "https://example.com/w", title: "Weather" },
              { type: "api", url: "" },
            ],
          },
        },
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "It is sunny." }],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    }

    const anthropic = translateResponsesToAnthropic(response)

    expect(anthropic.content).toEqual([
      {
        type: "server_tool_use",
        id: "ws_1",
        name: "web_search",
        input: { query: "weather boston" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "ws_1",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/w",
            title: "Weather",
            page_age: null,
            encrypted_content: "",
          },
        ],
      },
      { type: "text", text: "It is sunny." },
    ])
    // A completed server-side search is not a client tool_use stop
    expect(anthropic.stop_reason).toBe("end_turn")
    expect(anthropic.usage.server_tool_use).toEqual({ web_search_requests: 1 })
  })
})
