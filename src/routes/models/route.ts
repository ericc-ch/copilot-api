import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"
import modelConsumptionData from "~/lib/model-consumption.json"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    // Create a map for quick consumption lookup
    const consumptionMap = new Map(
      modelConsumptionData.models.map((m) => [m.name, m.consumption]),
    )

    // Helper function to convert consumption string to number for sorting
    const consumptionToNumber = (consumption: string): number => {
      if (consumption === "N/A") return 999 // Put N/A at the end
      const match = consumption.match(/^([\d.]+)x$/)
      return match ? Number.parseFloat(match[1]) : 999
    }

    // Filter to only include models with context window information (Available models)
    const models = state.models?.data
      .filter((model) => {
        const maxTokens = model.capabilities?.limits?.max_context_window_tokens
        return typeof maxTokens === "number"
      })
      .map((model) => ({
        model,
        consumption: consumptionMap.get(model.name) || "N/A",
      }))
      .sort((a, b) => consumptionToNumber(a.consumption) - consumptionToNumber(b.consumption))
      .map((item) => ({
        id: item.model.id,
        object: "model",
        type: "model",
        created: 0, // No date available from source
        created_at: new Date(0).toISOString(), // No date available from source
        owned_by: item.model.vendor,
        display_name: item.model.name,
        max_context_length: item.model.capabilities?.limits?.max_context_window_tokens,
      }))

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
