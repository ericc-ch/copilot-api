import { getModels } from "~/services/copilot/get-models"

import { state } from "./state"

/**
 * Transform model name from client-facing format to internal format
 * Example: "claude-4-sonnet" -> "claude-sonnet-4"
 */
export function transformModelName(modelName: string): string {
  if (modelName === "claude-4-sonnet") {
    return "claude-sonnet-4"
  }

  // claude-4-sonnet-20250514
  if (modelName.startsWith("claude-sonnet-4-")) {
    return "claude-sonnet-4"
  }

  if (modelName.startsWith("claude-3-7-sonnet-")) {
    return "claude-sonnet-3.7"
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
