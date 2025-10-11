import consola from "consola"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}

export const setupPingInterval = (
  stream: {
    writeSSE: (data: { event: string; data: string }) => Promise<void>
  },
  intervalMs: number = 3000,
) => {
  const pingInterval = setInterval(async () => {
    try {
      await stream.writeSSE({
        event: "ping",
        data: "",
      })
      consola.debug("Sent ping")
    } catch (error) {
      consola.warn("Failed to send ping:", error)
      clearInterval(pingInterval)
    }
  }, intervalMs)

  return pingInterval
}
