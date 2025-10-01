import type {
  GeminiTool,
  GeminiRequest,
  GeminiContent,
  GeminiPart,
} from "~/routes/generate-content/types"
import type { Tool } from "~/services/copilot/create-chat-completions"

// Tool declaration generation - moved from translation.ts
export function translateGeminiToolsToOpenAI(
  geminiTools?: Array<GeminiTool>,
): Array<Tool> | undefined {
  if (!geminiTools || geminiTools.length === 0) return undefined

  const tools: Array<Tool> = []
  for (const tool of geminiTools) {
    // Handle standard function declarations
    if (tool.functionDeclarations) {
      for (const func of tool.functionDeclarations) {
        // Validate that function name exists and is not empty
        if (
          !func.name
          || typeof func.name !== "string"
          || func.name.trim() === ""
        ) {
          continue
        }

        // Ensure parameters is always a valid object
        const validParameters = func.parametersJsonSchema
          || func.parameters || { type: "object", properties: {} }

        tools.push({
          type: "function",
          function: {
            name: func.name,
            description: func.description,
            parameters: validParameters,
          },
        })
      }
    }

    // Handle googleSearch tool (special case)
    if (tool.googleSearch !== undefined) {
      tools.push({
        type: "function",
        function: {
          name: "google_web_search",
          description:
            "Performs a web search using Google Search (via the Gemini API) and returns the results. This tool is useful for finding information on the internet based on a query.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to find information on the web.",
              },
            },
            required: ["query"],
          },
        },
      })
    }

    // Handle urlContext tool (special case for web_fetch)
    // Note: GitHub Copilot API doesn't support web_fetch functionality
    // Skip this tool to avoid "Failed to create chat completions" errors
    if (tool.urlContext !== undefined) {
      continue
    }
  }

  return tools.length > 0 ? tools : undefined
}

// Tool configuration translation - moved from translation.ts
export function translateGeminiToolConfigToOpenAI(
  toolConfig?: GeminiRequest["toolConfig"],
): "auto" | "required" | "none" | undefined {
  if (!toolConfig) return undefined

  const mode = toolConfig.functionCallingConfig.mode
  switch (mode) {
    case "AUTO": {
      return "auto"
    }
    case "ANY": {
      return "required"
    }
    case "NONE": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// Utility function to generate unique tool call IDs - moved from translation.ts
// Generate IDs within 40 character limit (API constraint)
export function generateToolCallId(_functionName: string): string {
  const timestamp = Date.now().toString(36) // Base36 for shorter encoding
  const random = Math.random().toString(36).slice(2, 8) // 6 chars random
  return `call_${timestamp}_${random}` // Format: call_{timestamp}_{random}
}

// Helper function to try parsing and creating a function call - moved from translation.ts
// NOTE: Used internally by ToolCallAccumulator.handleToolCallWithName() and handleToolCallAccumulation()
// knip may report this as unused, but it's called within this module's class methods
export function tryCreateFunctionCall(
  name: string,
  argumentsStr: string,
): GeminiPart | null {
  try {
    const args = JSON.parse(argumentsStr) as Record<string, unknown>
    return {
      functionCall: {
        name,
        args,
      },
    }
  } catch {
    return null
  }
}

// Tool synthesis from contents - moved from translation.ts
export function synthesizeToolsFromContents(
  contents: Array<
    | GeminiContent
    | Array<{
        functionResponse: { id?: string; name: string; response: unknown }
      }>
  >,
): Array<Tool> | undefined {
  const names = new Set<string>()
  for (const item of contents) {
    if (Array.isArray(item)) continue
    for (const part of item.parts) {
      if ("functionCall" in part && part.functionCall.name) {
        names.add(part.functionCall.name)
      }
    }
  }
  if (names.size === 0) return undefined
  return Array.from(names).map((name) => ({
    type: "function",
    function: { name, parameters: { type: "object", properties: {} } },
  }))
}

/**
 * Tool call state manager for incremental parameter accumulation in streaming responses
 */
export class ToolCallAccumulator {
  private accumulator = new Map<
    number,
    {
      name: string
      arguments: string
      id?: string
    }
  >()

  /**
   * Handle tool call with function name (start of new tool call)
   */
  handleToolCallWithName(toolCall: {
    index: number
    id?: string
    function: {
      name: string
      arguments?: string
    }
  }): GeminiPart | null {
    const accumulatedArgs = toolCall.function.arguments || ""

    this.accumulator.set(toolCall.index, {
      name: toolCall.function.name,
      arguments: accumulatedArgs,
      id: toolCall.id,
    })

    // If we already have arguments, try to process immediately (for non-streaming models like Gemini)
    if (accumulatedArgs) {
      const functionCall = tryCreateFunctionCall(
        toolCall.function.name,
        accumulatedArgs,
      )
      if (functionCall) {
        // Clear the accumulator for this index since we've successfully processed it
        this.accumulator.delete(toolCall.index)
        return functionCall
      }
    }

    return null
  }

  /**
   * Handle tool call parameter accumulation (append argument fragments)
   */
  handleToolCallAccumulation(toolCall: {
    index: number
    function?: {
      arguments?: string
    }
  }): GeminiPart | null {
    const existingAccumulated = this.accumulator.get(toolCall.index)

    if (existingAccumulated && toolCall.function?.arguments) {
      existingAccumulated.arguments += toolCall.function.arguments

      const functionCall = tryCreateFunctionCall(
        existingAccumulated.name,
        existingAccumulated.arguments,
      )
      if (functionCall) {
        // Clear the accumulator for this index since we've successfully processed it
        this.accumulator.delete(toolCall.index)
        return functionCall
      }
    }

    return null
  }

  /**
   * Clear all accumulated state (for stream end or error reset)
   */
  clear(): void {
    this.accumulator.clear()
  }
}

/**
 * Process tool calls array and generate Gemini format parts
 * Supports both complete parameters and fragmented parameters modes
 */
export function processToolCalls(
  toolCalls: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>,
  accumulator: ToolCallAccumulator,
): Array<GeminiPart> {
  const parts: Array<GeminiPart> = []

  for (const toolCall of toolCalls) {
    // Debug: Log streaming tool call arguments to verify what GitHub Copilot returns
    if (process.env.DEBUG_GEMINI_REQUESTS === "true") {
      console.log(
        `[DEBUG STREAM] Tool call - name: ${toolCall.function?.name}, arguments: "${toolCall.function?.arguments}", type: ${typeof toolCall.function?.arguments}, truthy: ${Boolean(toolCall.function?.arguments)}`,
      )
    }

    // If this chunk has a function name, it's the start of a new tool call
    if (toolCall.function?.name && toolCall.function.name.trim() !== "") {
      const functionCall = accumulator.handleToolCallWithName({
        index: toolCall.index,
        id: toolCall.id,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })
      if (functionCall) {
        parts.push(functionCall)
      }
      continue
    }

    // If we have existing accumulated data and this chunk has arguments, append them
    const functionCall = accumulator.handleToolCallAccumulation(toolCall)
    if (functionCall) {
      parts.push(functionCall)
    }
  }

  return parts
}
