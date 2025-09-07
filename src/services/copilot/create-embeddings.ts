import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Setup timeout with AbortController
  const controller = new AbortController()
  const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
      method: "POST",
      headers: copilotHeaders(state),
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok)
      throw new HTTPError("Failed to create embeddings", response)

    return (await response.json()) as EmbeddingResponse
  } finally {
    clearTimeout(timeout)
  }
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
