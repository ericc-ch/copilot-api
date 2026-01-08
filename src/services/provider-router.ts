import consola from "consola"

import { state } from "~/lib/state"
import { createBedrockChatCompletions } from "~/services/bedrock/create-chat-completions"
import {
  createChatCompletions,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

/**
 * Route requests to the appropriate provider based on model name
 * - Opus models → GitHub Copilot API
 * - Sonnet/Haiku models → Round-robin between Copilot and Bedrock
 */
export async function routeToProvider(payload: ChatCompletionsPayload) {
  const provider = determineProvider(payload.model)

  consola.info(`Routing "${payload.model}" → ${provider.toUpperCase()}`)

  if (provider === "bedrock") {
    return createBedrockChatCompletions(payload)
  }

  return createChatCompletions(payload)
}

/**
 * Determine which provider to use based on model name with round-robin for Sonnet/Haiku
 */
function determineProvider(model: string): "copilot" | "bedrock" {
  const modelLower = model.toLowerCase()

  // Opus always uses Copilot
  if (modelLower.includes("opus")) {
    return "copilot"
  }

  // Check if AWS Bedrock is configured
  const bedrockConfigured =
    state.awsRegion && state.awsAccessKeyId && state.awsSecretAccessKey

  // Sonnet and Haiku use round-robin between Copilot and Bedrock (if configured)
  if (modelLower.includes("sonnet") || modelLower.includes("haiku")) {
    if (!bedrockConfigured) {
      // If Bedrock not configured, always use Copilot
      return "copilot"
    }

    // Round-robin: increment counter and alternate between providers
    state.providerRoundRobinCounter++
    const useBedrockForThisRequest = state.providerRoundRobinCounter % 2 === 0

    return useBedrockForThisRequest ? "bedrock" : "copilot"
  }

  // Default to Copilot for any other model
  return "copilot"
}
