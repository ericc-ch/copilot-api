import type { ModelSession } from "~/services/copilot/create-model-session"
import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  modelSession?: ModelSession
  proxyBaseUrl?: string
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
}
