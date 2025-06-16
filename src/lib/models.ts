import { getModels } from "~/services/copilot/get-models"

import { state } from "./state"

/**
 * Transform disguised model names back to real Claude model names
 *
 * STRATEGY: Cursor sees "gpt-4-claude-sonnet-4" and sends OpenAI format,
 * but we need to map it back to real Claude model for GitHub Copilot API.
 */
export function transformModelName(modelName: string): string {
  // Handle disguised Claude models - map back to real Claude models
  if (modelName === "gpt-4.1") {
    return "claude-sonnet-4"
  }

  if (modelName.startsWith("gpt-4.1-")) {
    return "gpt-4.1"
  }


  return modelName
}

/**
 * Transform model name from internal format to client-facing format
 * Example: "claude-sonnet-4" -> "claude-4-sonnet"
 */
export function reverseTransformModelName(modelName: string): string {
  if (modelName === "claude-sonnet-4") {
    return "claude-4-sonnet"
  }

  return modelName
}

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models
}
