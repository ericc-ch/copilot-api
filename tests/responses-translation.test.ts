import { describe, expect, it } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type {
  ResponseInputMessage,
  ResponsesResult,
} from "~/services/copilot/create-responses"

import {
  translateAnthropicMessagesToResponsesPayload,
  translateResponsesResultToAnthropic,
} from "~/routes/messages/responses-translation"

const samplePayload = {
  model: "claude-3-5-sonnet",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nThis is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.\n</system-reminder>",
        },
        {
          type: "text",
          text: "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# important-instruction-reminders\nDo what has been asked; nothing more, nothing less.\nNEVER create files unless they're absolutely necessary for achieving your goal.\nALWAYS prefer editing an existing file to creating a new one.\nNEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n\n      \n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>",
        },
        {
          type: "text",
          text: "hi",
        },
        {
          type: "text",
          text: "<system-reminder>\nThe user opened the file c:\\Work2\\copilot-api\\src\\routes\\responses\\translation.ts in the IDE. This may or may not be related to the current task.\n</system-reminder>",
        },
        {
          type: "text",
          text: "hi",
          cache_control: {
            type: "ephemeral",
          },
        },
      ],
    },
  ],
} as unknown as AnthropicMessagesPayload

describe("translateAnthropicMessagesToResponsesPayload", () => {
  it("converts anthropic text blocks into response input messages", () => {
    const result = translateAnthropicMessagesToResponsesPayload(samplePayload)

    expect(Array.isArray(result.input)).toBe(true)
    const input = result.input as Array<ResponseInputMessage>
    expect(input).toHaveLength(1)

    const message = input[0]
    expect(message.role).toBe("user")
    expect(Array.isArray(message.content)).toBe(true)

    const content = message.content as Array<{ text: string }>
    expect(content.map((item) => item.text)).toEqual([
      "<system-reminder>\nThis is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.\n</system-reminder>",
      "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# important-instruction-reminders\nDo what has been asked; nothing more, nothing less.\nNEVER create files unless they're absolutely necessary for achieving your goal.\nALWAYS prefer editing an existing file to creating a new one.\nNEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n\n      \n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>",
      "hi",
      "<system-reminder>\nThe user opened the file c:\\Work2\\copilot-api\\src\\routes\\responses\\translation.ts in the IDE. This may or may not be related to the current task.\n</system-reminder>",
      "hi",
    ])
  })
})

describe("translateResponsesResultToAnthropic", () => {
  it("handles reasoning and function call items", () => {
    const responsesResult: ResponsesResult = {
      id: "resp_123",
      object: "response",
      created_at: 0,
      model: "gpt-4.1",
      output: [
        {
          id: "reason_1",
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Thinking about the task." }],
          status: "completed",
          encrypted_content: "encrypted_reasoning_content",
        },
        {
          id: "call_1",
          type: "function_call",
          call_id: "call_1",
          name: "TodoWrite",
          arguments:
            '{"todos":[{"content":"Read src/routes/responses/translation.ts","status":"in_progress"}]}',
          status: "completed",
        },
        {
          id: "message_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Added the task to your todo list.",
              annotations: [],
            },
          ],
        },
      ],
      output_text: "Added the task to your todo list.",
      status: "incomplete",
      usage: {
        input_tokens: 120,
        output_tokens: 36,
        total_tokens: 156,
      },
      error: null,
      incomplete_details: { reason: "content_filter" },
      instructions: null,
      metadata: null,
      parallel_tool_calls: false,
      temperature: null,
      tool_choice: null,
      tools: [],
      top_p: null,
    }

    const anthropicResponse =
      translateResponsesResultToAnthropic(responsesResult)

    expect(anthropicResponse.stop_reason).toBe("end_turn")
    expect(anthropicResponse.content).toHaveLength(3)

    const [thinkingBlock, toolUseBlock, textBlock] = anthropicResponse.content

    expect(thinkingBlock.type).toBe("thinking")
    if (thinkingBlock.type === "thinking") {
      expect(thinkingBlock.thinking).toContain("Thinking about the task")
    }

    expect(toolUseBlock.type).toBe("tool_use")
    if (toolUseBlock.type === "tool_use") {
      expect(toolUseBlock.id).toBe("call_1")
      expect(toolUseBlock.name).toBe("TodoWrite")
      expect(toolUseBlock.input).toEqual({
        todos: [
          {
            content: "Read src/routes/responses/translation.ts",
            status: "in_progress",
          },
        ],
      })
    }

    expect(textBlock.type).toBe("text")
    if (textBlock.type === "text") {
      expect(textBlock.text).toBe("Added the task to your todo list.")
    }
  })
})
