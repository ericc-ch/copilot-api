import consola from "consola"

import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { state } from "~/lib/state"

export const getCopilotToken = async () => {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
    {
      headers: githubHeaders(state),
    },
  )

  if (!response.ok) {
    const status = response.status
    let responseBody = ""
    try {
      responseBody = await response.text()
    } catch {
      consola.error("Could not read response body when getting Copilot token")
      // responseBody will remain "" if text() fails
    }

    consola.error(`Failed to get Copilot token: Status ${status}`)
    consola.error(`Response: ${responseBody}`)

    throw new HTTPError(
      `Failed to get Copilot token: Status ${status}`,
      response,
    )
  }

  return (await response.json()) as GetCopilotTokenResponse
}

// Trimmed for the sake of simplicity
interface GetCopilotTokenResponse {
  expires_at: number
  refresh_in: number
  token: string
}
