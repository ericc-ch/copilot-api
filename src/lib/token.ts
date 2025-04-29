import consola from "consola"
import fs from "node:fs/promises"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./http-error"
import { state } from "./state"

/** Reads the GitHub token from the designated file path. */
const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

/** Writes the GitHub token to the designated file path. */
const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

/**
 * Fetches the Copilot API token using the GitHub token and sets up
 * an interval to automatically refresh it before expiration.
 */
export const setupCopilotToken = async () => {
  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token

  const refreshInterval = (refresh_in - 60) * 1000

  setInterval(async () => {
    consola.start("Refreshing Copilot token")
    try {
      const { token } = await getCopilotToken()
      state.copilotToken = token
    } catch (error) {
      consola.error("Failed to refresh Copilot token:", error)
      throw error
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  /** If true, forces a new authentication flow even if a token exists. */
  force?: boolean
}

/**
 * Sets up the GitHub token state.
 * Reads from file if available, otherwise initiates the device auth flow.
 * @param options - Configuration options for the setup process.
 */
export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

/** Fetches the GitHub user profile and logs the username. */
async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
