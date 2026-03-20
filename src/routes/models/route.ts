import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    // Only surface models that are enabled for user selection by default.
    // Pass ?all=1 to see every model including internal/preview ones.
    const showAll = c.req.query("all") === "1"

    const models = state.models?.data
      .filter((model) => showAll || model.model_picker_enabled)
      .map((model) => ({
        id: model.id,
        object: "model",
        type: "model",
        created: 0, // No date available from source
        created_at: new Date(0).toISOString(), // No date available from source
        owned_by: model.vendor,
        display_name: model.name,
        preview: model.preview,
        capabilities: {
          supports_tool_calls: model.capabilities.supports.tool_calls ?? false,
          supports_parallel_tool_calls:
            model.capabilities.supports.parallel_tool_calls ?? false,
          max_context_window_tokens:
            model.capabilities.limits.max_context_window_tokens,
          max_output_tokens: model.capabilities.limits.max_output_tokens,
        },
      }))

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return forwardError(c, error)
  }
})
