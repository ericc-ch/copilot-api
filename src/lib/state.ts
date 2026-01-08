import type { ModelsResponse } from "~/services/copilot/get-models"

import { RequestQueue } from "./queue"
import { RequestCache } from "./request-cache"

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
  requestQueue: RequestQueue

  // Request caching for deduplication
  requestCache: RequestCache
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  requestQueue: new RequestQueue(),
  requestCache: new RequestCache(30, 1000), // 30s TTL, max 1000 entries
}
