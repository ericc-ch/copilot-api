import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { state } from "~/lib/state"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  // return (await response.json()) as EmbeddingResponse

  const json = await response.json()

  return json as EmbeddingResponse
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
