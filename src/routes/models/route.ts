import { Hono } from "hono"

import { forwardError } from "~/lib/forward-error"
import { reverseTransformModelName } from "~/lib/models"
import { getModels } from "~/services/copilot/get-models"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    const models = await getModels()

    // Transform model names to client-facing format
    const transformedModels = {
      ...models,
      data: models.data.map((model) => ({
        ...model,
        id: reverseTransformModelName(model.id),
      })),
    }

    return c.json(transformedModels)
  } catch (error) {
    return await forwardError(c, error)
  }
})
