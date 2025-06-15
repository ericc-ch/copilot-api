import { state } from "./state"

/**
 * Check if the model vendor is Anthropic (Claude models)
 */
export const isAnthropicVendor = (modelName: string): boolean => {
  if (!state.models?.data) return false

  const model = state.models.data.find((m) => m.id === modelName)
  return model?.vendor === "Anthropic"
}

/**
 * Get model information by name
 */
export const getModelInfo = (modelName: string) => {
  if (!state.models?.data) return null

  return state.models.data.find((m) => m.id === modelName)
}

/**
 * Check if model supports vision
 * Note: Vision support is not explicitly defined in the API response,
 * so we check based on model name patterns
 */
export const supportsVision = (modelName: string): boolean => {
  // For now, assume vision support based on model name patterns
  // This can be updated when the API provides explicit vision support info
  return modelName.includes("gpt-4") || modelName.includes("claude")
}

/**
 * Check if model supports tool calls
 */
export const supportsToolCalls = (modelName: string): boolean => {
  const model = getModelInfo(modelName)
  return model?.capabilities?.supports?.tool_calls === true
}
