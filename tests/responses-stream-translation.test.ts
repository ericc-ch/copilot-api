import { describe, expect, test } from "bun:test"

import type { AnthropicStreamEventData } from "~/routes/messages/anthropic-types"
import type {
  ResponseOutputItemAddedEvent,
  ResponseFunctionCallArgumentsDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
} from "~/services/copilot/create-responses"

import {
  createResponsesStreamState,
  translateResponsesStreamEvent,
} from "~/routes/messages/responses-stream-translation"

const createFunctionCallAddedEvent = (): ResponseOutputItemAddedEvent => ({
  type: "response.output_item.added",
  sequence_number: 1,
  output_index: 1,
  item: {
    id: "item-1",
    type: "function_call",
    call_id: "call-1",
    name: "TodoWrite",
    arguments: "",
    status: "in_progress",
  },
})

describe("translateResponsesStreamEvent tool calls", () => {
  test("streams function call arguments across deltas", () => {
    const state = createResponsesStreamState()

    const events = [
      translateResponsesStreamEvent(createFunctionCallAddedEvent(), state),
      translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 1,
          sequence_number: 2,
          delta: '{"todos":',
        } as ResponseFunctionCallArgumentsDeltaEvent,
        state,
      ),
      translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 1,
          sequence_number: 3,
          delta: "[]}",
        } as ResponseFunctionCallArgumentsDeltaEvent,
        state,
      ),
      translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.done",
          item_id: "item-1",
          name: "TodoWrite",
          output_index: 1,
          sequence_number: 4,
          arguments: '{"todos":[]}',
        } as ResponseFunctionCallArgumentsDoneEvent,
        state,
      ),
    ].flat()

    const blockStart = events.find(
      (event) => event.type === "content_block_start",
    )
    expect(blockStart).toBeDefined()
    if (blockStart?.type === "content_block_start") {
      expect(blockStart.content_block).toEqual({
        type: "tool_use",
        id: "call-1",
        name: "TodoWrite",
        input: {},
      })
    }

    const deltas = events.filter(
      (
        event,
      ): event is Extract<
        AnthropicStreamEventData,
        { type: "content_block_delta" }
      > => event.type === "content_block_delta",
    )
    expect(deltas).toHaveLength(2)
    expect(deltas[0].delta).toEqual({
      type: "input_json_delta",
      partial_json: '{"todos":',
    })
    expect(deltas[1].delta).toEqual({
      type: "input_json_delta",
      partial_json: "[]}",
    })

    expect(state.openBlocks.size).toBe(1)
    expect(state.functionCallStateByOutputIndex.size).toBe(0)
  })

  test("emits full arguments when only done payload is present", () => {
    const state = createResponsesStreamState()

    const events = [
      translateResponsesStreamEvent(createFunctionCallAddedEvent(), state),
      translateResponsesStreamEvent(
        {
          type: "response.function_call_arguments.done",
          item_id: "item-1",
          name: "TodoWrite",
          output_index: 1,
          sequence_number: 2,
          arguments:
            '{"todos":[{"content":"Review src/routes/responses/translation.ts"}]}',
        } as ResponseFunctionCallArgumentsDoneEvent,
        state,
      ),
    ].flat()

    const deltas = events.filter(
      (
        event,
      ): event is Extract<
        AnthropicStreamEventData,
        { type: "content_block_delta" }
      > => event.type === "content_block_delta",
    )
    expect(deltas).toHaveLength(1)
    expect(deltas[0].delta).toEqual({
      type: "input_json_delta",
      partial_json:
        '{"todos":[{"content":"Review src/routes/responses/translation.ts"}]}',
    })

    expect(state.openBlocks.size).toBe(1)
    expect(state.functionCallStateByOutputIndex.size).toBe(0)
  })
})
