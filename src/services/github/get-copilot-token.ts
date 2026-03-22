import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { sleep } from "~/lib/utils"

const COPILOT_TOKEN_TIMEOUT_MS = 10_000
const COPILOT_TOKEN_MAX_RETRIES = 3
const COPILOT_TOKEN_RETRY_DELAY_MS = 500

const isRetryableNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const networkErrorCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ENOTFOUND",
  ])
  const maybeCode = (error as Error & { code?: unknown }).code
  const code = typeof maybeCode === "string" ? maybeCode : undefined

  if (code && networkErrorCodes.has(code)) return true

  return /socket connection was closed unexpectedly|network|fetch failed|timeout|timed out/i.test(
    error.message,
  )
}

export const getCopilotToken = async () => {
  let lastError: unknown

  for (let attempt = 1; attempt <= COPILOT_TOKEN_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, COPILOT_TOKEN_TIMEOUT_MS)

    try {
      const response = await fetch(
        `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
        {
          headers: githubHeaders(state),
          signal: controller.signal,
        },
      )

      if (!response.ok)
        throw new HTTPError("Failed to get Copilot token", response)

      return (await response.json()) as GetCopilotTokenResponse
    } catch (error) {
      lastError = error
      if (
        attempt >= COPILOT_TOKEN_MAX_RETRIES
        || !isRetryableNetworkError(error)
      ) {
        throw error
      }
      await sleep(COPILOT_TOKEN_RETRY_DELAY_MS * 2 ** (attempt - 1))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : (
      new Error("Failed to get Copilot token")
    )
}

// Trimmed for the sake of simplicity
interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
