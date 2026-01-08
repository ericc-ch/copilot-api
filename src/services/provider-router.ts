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
 * - Sonnet/Haiku models → AWS Bedrock (if configured)
 */
export async function routeToProvider(payload: ChatCompletionsPayload) {
  const provider = determineProvider(payload.model)

  consola.debug(`Routing model "${payload.model}" to provider: ${provider}`)

  if (provider === "bedrock") {
    return createBedrockChatCompletions(payload)
  }

  return createChatCompletions(payload)
}

/**
 * Determine which provider to use based on model name
 */
function determineProvider(model: string): "copilot" | "bedrock" {
  const modelLower = model.toLowerCase()

  // Check if AWS Bedrock is configured
  const bedrockConfigured =
    state.awsRegion && state.awsAccessKeyId && state.awsSecretAccessKey

  // Sonnet and Haiku use Bedrock if configured
  if (
    bedrockConfigured
    && (modelLower.includes("sonnet") || modelLower.includes("haiku"))
  ) {
    return "bedrock"
  }

  // Opus always uses Copilot (or fallback to Copilot if Bedrock not configured)
  return "copilot"
}
