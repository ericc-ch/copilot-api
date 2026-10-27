import { beforeEach, describe, expect, test } from "bun:test"

import {
  parseThinkingRejection,
  thinkingTypeReplacements,
} from "~/services/copilot/thinking-type"

import {
  BETWEEN_TOOLS_REJECTED,
  ENABLED_REJECTED,
  errorBody,
  OPUS_DISABLED_REJECTED,
  SONNET_DISABLED_REJECTED,
} from "./fixtures/thinking-errors"

describe("parseThinkingRejection", () => {
  test("reads the rejected type and the type that follows Use", () => {
    expect(parseThinkingRejection(ENABLED_REJECTED)).toEqual({
      rejected: "enabled",
      accepted: "adaptive",
    })
    expect(parseThinkingRejection(OPUS_DISABLED_REJECTED)).toEqual({
      rejected: "disabled",
      accepted: "adaptive",
    })
  })

  test("reads the replacement type", () => {
    expect(parseThinkingRejection(SONNET_DISABLED_REJECTED)).toEqual({
      rejected: "disabled",
      accepted: "between_tools",
    })
  })

  test("reads the message from an Anthropic error body", () => {
    expect(parseThinkingRejection(errorBody(OPUS_DISABLED_REJECTED))).toEqual({
      rejected: "disabled",
      accepted: "adaptive",
    })
  })

  test("returns no accepted type when the error names none", () => {
    expect(parseThinkingRejection(BETWEEN_TOOLS_REJECTED)).toEqual({
      rejected: "between_tools",
      accepted: undefined,
    })
  })

  test("returns nothing for other errors", () => {
    expect(
      parseThinkingRejection("The requested model is not supported."),
    ).toBeUndefined()
  })
})

describe("thinkingTypeReplacements", () => {
  const opusDisabled = { model: "claude-opus-5-5", requested: "disabled" }

  beforeEach(() => {
    thinkingTypeReplacements.clear()
  })

  test("sends the requested type until a replacement is remembered", () => {
    expect(thinkingTypeReplacements.typeToSend(opusDisabled)).toBe("disabled")
    thinkingTypeReplacements.remember(opusDisabled, "adaptive")
    expect(thinkingTypeReplacements.typeToSend(opusDisabled)).toBe("adaptive")
    expect(
      thinkingTypeReplacements.typeToSend({
        model: "claude-sonnet-5-5",
        requested: "disabled",
      }),
    ).toBe("disabled")
  })

  test("returns the retry type only when the error rejects the sent type", () => {
    expect(
      thinkingTypeReplacements.retryType(
        { model: "claude-opus-5-5", requested: "disabled" },
        "disabled",
        OPUS_DISABLED_REJECTED,
      ),
    ).toBe("adaptive")
    expect(
      thinkingTypeReplacements.retryType(
        { model: "claude-opus-5-5", requested: "enabled" },
        "enabled",
        OPUS_DISABLED_REJECTED,
      ),
    ).toBeUndefined()
    expect(
      thinkingTypeReplacements.retryType(
        { model: "claude-opus-5-5", requested: "between_tools" },
        "between_tools",
        BETWEEN_TOOLS_REJECTED,
      ),
    ).toBeUndefined()
  })

  test("forgets a replacement that Copilot rejects", () => {
    thinkingTypeReplacements.remember(opusDisabled, "adaptive")
    thinkingTypeReplacements.retryType(
      { model: "claude-opus-5-5", requested: "disabled" },
      "adaptive",
      '"thinking.type.adaptive" is not supported for this model.',
    )
    expect(thinkingTypeReplacements.typeToSend(opusDisabled)).toBe("disabled")
  })
})
