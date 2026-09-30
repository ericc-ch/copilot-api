import { Hono } from "hono"

import { awaitApproval } from "~/lib/approval"
import { forwardError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    // same request guards as the other generation routes: embeddings
    // calls must not bypass --rate-limit / --manual safeguards
    await checkRateLimit(state)
    if (state.manualApprove) await awaitApproval()

    const paylod = await c.req.json<EmbeddingRequest>()
    const response = await createEmbeddings(paylod)

    return c.json(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
