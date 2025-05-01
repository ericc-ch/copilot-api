import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { state } from "~/lib/state"

export const getModels = async () => {
  if (!state.copilotToken) {
    throw new Error("Copilot token is missing. Please authenticate first.")
  }

  const url = `${copilotBaseUrl(state)}/models`
  const headers = copilotHeaders(state)

  // Log the request details (excluding sensitive information)
  consola.info(`Making request to: ${url}`)
  consola.info(
    `Headers: ${JSON.stringify({
      ...headers,
      Authorization: headers.Authorization ? "[REDACTED]" : undefined,
    })}`,
  )

  const response = await fetch(url, {
    headers,
  })

  if (!response.ok) {
    const status = response.status
    let responseBody = "" // Declare inside the block
    try {
      responseBody = await response.text()
    } catch {
      consola.error("Could not read response body when getting models")
      // responseBody will remain "" if text() fails
    }

    consola.error(`Failed to get models: Status ${status}`)
    consola.error(`Response: ${responseBody}`) // Log the potentially empty body

    throw new HTTPError(`Failed to get models: Status ${status}`, response)
  } // Correctly close the if block

  return (await response.json()) as ModelsResponse
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
}
