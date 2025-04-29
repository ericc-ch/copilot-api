import type { ModelsResponse } from "~/services/copilot/get-models"

/**
 * Represents the application's global mutable state.
 * Holds configuration, tokens, and runtime information.
 */
export interface State {
  /** GitHub personal access token (obtained via device flow). */
  githubToken?: string
  /** Short-lived Copilot API token. */
  copilotToken?: string

  /** Account type ("individual" or "business"). */
  accountType: string
  /** Cached response from the /models endpoint. */
  models?: ModelsResponse
  /** Cached VSCode version string used in API headers. */
  vsCodeVersion?: string

  /** Flag to enable manual approval prompt for each request. */
  manualApprove: boolean
  /** Flag to wait instead of erroring when rate limit is hit. */
  rateLimitWait: boolean

  /** Rate limit interval in seconds (if enabled). */
  rateLimitSeconds?: number
  /** Timestamp of the last request made (for rate limiting). */
  lastRequestTimestamp?: number
}

/** The global state object instance. */
export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
}
