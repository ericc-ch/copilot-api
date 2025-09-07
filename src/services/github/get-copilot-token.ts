import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const getCopilotToken = async () => {
  // Setup timeout with AbortController
  const controller = new AbortController()
  const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

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
  } finally {
    clearTimeout(timeout)
  }
}

// Trimmed for the sake of simplicity
interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
