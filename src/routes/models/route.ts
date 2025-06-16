import { Hono } from "hono"

import { forwardError } from "~/lib/forward-error"
import { reverseTransformModelName } from "~/lib/models"
import { getModels } from "~/services/copilot/get-models"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    const models = await getModels()

    // Transform model names and disguise Claude models as GPT models
    // This prevents Cursor from detecting Claude models and sending Anthropic format
    const transformedModels = {
      ...models,
      data: models.data.map((model) => {
        const transformedModel = { ...model }

        // Disguise Claude models as GPT models to force OpenAI format
        if (model.id.includes('claude-sonnet-4')) {
          transformedModel.id = 'gpt-4-claude-sonnet-4'
          transformedModel.name = 'GPT-4 (Claude Sonnet 4)'
          transformedModel.vendor = 'OpenAI'
        } else if (model.id.includes('claude-sonnet-3.7')) {
          transformedModel.id = 'gpt-4-claude-sonnet-37'
          transformedModel.name = 'GPT-4 (Claude Sonnet 3.7)'
          transformedModel.vendor = 'OpenAI'
        } else if (model.id.includes('claude-sonnet-3.5')) {
          transformedModel.id = 'gpt-35-turbo-claude-sonnet-35'
          transformedModel.name = 'GPT-3.5 Turbo (Claude Sonnet 3.5)'
          transformedModel.vendor = 'OpenAI'
        } else if (model.id.includes('claude')) {
          // Handle other Claude models
          const claudeId = model.id.replace(/[^a-z0-9]/gi, '')
          transformedModel.id = `gpt-4-${claudeId}`
          transformedModel.name = `GPT-4 (${model.name || model.id})`
          transformedModel.vendor = 'OpenAI'
        } else {
          // Non-Claude models pass through with normal transformation
          transformedModel.id = reverseTransformModelName(model.id)
        }

        return transformedModel
      }),
    }

    return c.json(transformedModels)
  } catch (error) {
    return await forwardError(c, error)
  }
})
