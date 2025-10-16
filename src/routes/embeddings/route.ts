import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { recordRequest, recordTokenUsage } from "~/lib/metrics"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    const paylod = await c.req.json<EmbeddingRequest>()
    const response = await createEmbeddings(paylod)

    // Record request and token usage
    recordRequest(paylod.model, "embeddings")
    recordTokenUsage(
      response.model,
      response.usage.prompt_tokens,
      0, // Embeddings don't have output tokens
    )

    return c.json(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
