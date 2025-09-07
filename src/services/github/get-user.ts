import { GITHUB_API_BASE_URL, standardHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export async function getGitHubUser() {
  // Setup timeout with AbortController
  const controller = new AbortController()
  const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
      headers: {
        authorization: `token ${state.githubToken}`,
        ...standardHeaders(),
      },
      signal: controller.signal,
    })

    if (!response.ok) throw new HTTPError("Failed to get GitHub user", response)

    return (await response.json()) as GithubUserResponse
  } finally {
    clearTimeout(timeout)
  }
}

// Trimmed for the sake of simplicity
interface GithubUserResponse {
  login: string
}
