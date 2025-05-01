import consola from "consola"

import { getModels } from "~/services/copilot/get-models"

import { state } from "./state"

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models

  if (Array.isArray(models.data)) {
    // Check if data is an array
    consola.info(
      // Map over the data array
      `Available models: \n${models.data.map((model) => `- ${model.id}`).join("\n")}`,
    )
  } else {
    consola.warn("Could not list models: Invalid response format.")
  }
}
