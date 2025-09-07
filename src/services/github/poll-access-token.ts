import consola from "consola"

import {
  GITHUB_BASE_URL,
  GITHUB_CLIENT_ID,
  standardHeaders,
} from "~/lib/api-config"
import { state } from "~/lib/state"
import { sleep } from "~/lib/utils"

import type { DeviceCodeResponse } from "./get-device-code"

export async function pollAccessToken(
  deviceCode: DeviceCodeResponse,
): Promise<string> {
  // Interval is in seconds, we need to multiply by 1000 to get milliseconds
  // I'm also adding another second, just to be safe
  const sleepDuration = (deviceCode.interval + 1) * 1000
  consola.debug(`Polling access token with interval of ${sleepDuration}ms`)

  while (true) {
    // Setup timeout with AbortController
    const controller = new AbortController()
    const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(
        `${GITHUB_BASE_URL}/login/oauth/access_token`,
        {
          method: "POST",
          headers: standardHeaders(),
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        await sleep(sleepDuration)
        consola.error("Failed to poll access token:", await response.text())

        continue
      }

      const json = await response.json()
      consola.debug("Polling access token response:", json)

      const { access_token } = json as AccessTokenResponse

      if (access_token) {
        return access_token
      } else {
        await sleep(sleepDuration)
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        consola.error("Access token polling timed out")
        await sleep(sleepDuration)
        continue
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

interface AccessTokenResponse {
  access_token: string
  token_type: string
  scope: string
}
