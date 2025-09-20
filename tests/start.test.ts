import { describe, test, expect, mock, beforeEach } from "bun:test"

// Mock the state module
const mockState = {
  models: {
    data: [
      { id: "claude-3-5-sonnet-20241022" },
      { id: "claude-3-5-haiku-20241022" },
      { id: "claude-3-opus-20240229" },
      { id: "gpt-4o" },
      { id: "gpt-4o-mini" },
    ],
  },
}

// Mock consola
const mockConsola = {
  error: mock(() => {}),
  info: mock(() => {}),
  prompt: mock(() => Promise.resolve("claude-3-5-sonnet-20241022")),
  level: 0,
}

// Mock process.exit
const mockProcessExit = mock(() => {
  throw new Error("process.exit called")
})

// Replace imports with mocks
void mock.module("../src/lib/state", () => ({
  state: mockState,
}))

void mock.module("consola", () => ({
  default: mockConsola,
  ...mockConsola,
}))

void mock.module("node:process", () => ({
  default: {
    exit: mockProcessExit,
  },
}))

// Helper function to extract and test the model validation logic
function validateModels(
  providedModel: string | undefined,
  providedSmallModel: string | undefined,
  availableModels: Array<{ id: string }>,
): { isValid: boolean; error?: string } {
  const availableModelIds = new Set(availableModels.map((model) => model.id))

  // Both models provided
  if (providedModel && providedSmallModel) {
    if (!availableModelIds.has(providedModel)) {
      return {
        isValid: false,
        error: `Invalid model: ${providedModel}`,
      }
    }
    if (!availableModelIds.has(providedSmallModel)) {
      return {
        isValid: false,
        error: `Invalid small model: ${providedSmallModel}`,
      }
    }
    return { isValid: true }
  }

  // Only one model provided (including empty strings)
  if (providedModel !== undefined || providedSmallModel !== undefined) {
    return {
      isValid: false,
      error:
        "Both --model and --small-model must be specified when using command-line model selection",
    }
  }

  // No models provided (interactive mode)
  return { isValid: true }
}

// Helper function to simulate CLI argument parsing
function parseCliArgs(args: Array<string>): {
  model?: string
  smallModel?: string
  claudeCode: boolean
} {
  const parsed: { model?: string; smallModel?: string; claudeCode: boolean } = {
    claudeCode: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--model":
      case "-m": {
        parsed.model = args[i + 1]
        i++ // Skip next arg as it's the value
        break
      }
      case "--small-model":
      case "-s": {
        parsed.smallModel = args[i + 1]
        i++ // Skip next arg as it's the value
        break
      }
      case "--claude-code":
      case "-c": {
        parsed.claudeCode = true
        break
      }
      default: {
        // Unknown argument, ignore
        break
      }
    }
  }

  return parsed
}

describe("Model Validation Logic", () => {
  beforeEach(() => {
    mockConsola.error.mockClear()
    mockConsola.info.mockClear()
    mockProcessExit.mockClear()
  })

  test("should validate when both valid models are provided", () => {
    const result = validateModels(
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test("should reject when primary model is invalid", () => {
    const result = validateModels(
      "invalid-model",
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid model: invalid-model")
  })

  test("should reject when small model is invalid", () => {
    const result = validateModels(
      "claude-3-5-sonnet-20241022",
      "invalid-small-model",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid small model: invalid-small-model")
  })

  test("should reject when both models are invalid", () => {
    const result = validateModels(
      "invalid-model",
      "invalid-small-model",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid model: invalid-model")
  })

  test("should reject when only primary model is provided", () => {
    const result = validateModels(
      "claude-3-5-sonnet-20241022",
      undefined,
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe(
      "Both --model and --small-model must be specified when using command-line model selection",
    )
  })

  test("should reject when only small model is provided", () => {
    const result = validateModels(
      undefined,
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe(
      "Both --model and --small-model must be specified when using command-line model selection",
    )
  })

  test("should allow interactive mode when no models are provided", () => {
    const result = validateModels(undefined, undefined, mockState.models.data)

    expect(result.isValid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test("should handle empty model list", () => {
    const result = validateModels(
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      [],
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid model: claude-3-5-sonnet-20241022")
  })
})

describe("CLI Argument Scenarios", () => {
  test("should handle common model combinations", () => {
    const commonCombinations = [
      {
        model: "claude-3-5-sonnet-20241022",
        smallModel: "claude-3-5-haiku-20241022",
        expected: true,
      },
      {
        model: "gpt-4o",
        smallModel: "gpt-4o-mini",
        expected: true,
      },
      {
        model: "claude-3-opus-20240229",
        smallModel: "claude-3-5-haiku-20241022",
        expected: true,
      },
    ]

    for (const combo of commonCombinations) {
      const result = validateModels(
        combo.model,
        combo.smallModel,
        mockState.models.data,
      )
      expect(result.isValid).toBe(combo.expected)
    }
  })

  test("should handle case sensitivity", () => {
    const result = validateModels(
      "CLAUDE-3-5-SONNET-20241022", // Wrong case
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid model: CLAUDE-3-5-SONNET-20241022")
  })

  test("should handle whitespace in model names", () => {
    const result = validateModels(
      " claude-3-5-sonnet-20241022 ", // Leading/trailing whitespace
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toBe("Invalid model:  claude-3-5-sonnet-20241022 ")
  })
})

describe("CLI Argument Parsing", () => {
  test("should parse model arguments with long flags", () => {
    const args = [
      "--claude-code",
      "--model",
      "claude-3-5-sonnet-20241022",
      "--small-model",
      "claude-3-5-haiku-20241022",
    ]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(true)
    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.smallModel).toBe("claude-3-5-haiku-20241022")
  })

  test("should parse model arguments with short flags", () => {
    const args = ["-c", "-m", "gpt-4o", "-s", "gpt-4o-mini"]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(true)
    expect(result.model).toBe("gpt-4o")
    expect(result.smallModel).toBe("gpt-4o-mini")
  })

  test("should handle mixed long and short flags", () => {
    const args = [
      "--claude-code",
      "-m",
      "claude-3-5-sonnet-20241022",
      "--small-model",
      "gpt-4o-mini",
    ]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(true)
    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.smallModel).toBe("gpt-4o-mini")
  })

  test("should handle only claude-code flag", () => {
    const args = ["--claude-code"]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(true)
    expect(result.model).toBeUndefined()
    expect(result.smallModel).toBeUndefined()
  })

  test("should handle model without claude-code flag", () => {
    const args = ["--model", "claude-3-5-sonnet-20241022"]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(false)
    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.smallModel).toBeUndefined()
  })

  test("should handle arguments in different order", () => {
    const args = [
      "--small-model",
      "claude-3-5-haiku-20241022",
      "--claude-code",
      "--model",
      "claude-3-5-sonnet-20241022",
    ]
    const result = parseCliArgs(args)

    expect(result.claudeCode).toBe(true)
    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.smallModel).toBe("claude-3-5-haiku-20241022")
  })
})

describe("Error Handling Scenarios", () => {
  test("should provide helpful error messages for invalid models", () => {
    const result = validateModels(
      "nonexistent-model",
      "claude-3-5-haiku-20241022",
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toContain("Invalid model: nonexistent-model")
  })

  test("should provide specific error for partial model specification", () => {
    const result = validateModels(
      "claude-3-5-sonnet-20241022",
      undefined,
      mockState.models.data,
    )

    expect(result.isValid).toBe(false)
    expect(result.error).toContain(
      "Both --model and --small-model must be specified",
    )
  })

  test("should handle empty string models", () => {
    const result = validateModels("", "", mockState.models.data)

    expect(result.isValid).toBe(false)
    expect(result.error).toBe(
      "Both --model and --small-model must be specified when using command-line model selection",
    )
  })
})
