import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number

  // Authentication configuration
  authEnabled: boolean
  apiKeys: Array<string>
  skipAuthPaths: Array<string>
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  authEnabled: false,
  apiKeys: [],
  skipAuthPaths: ["/", "/health"],
}
