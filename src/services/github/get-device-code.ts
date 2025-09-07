import {
  GITHUB_APP_SCOPES,
  GITHUB_BASE_URL,
  GITHUB_CLIENT_ID,
  standardHeaders,
} from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export async function getDeviceCode(): Promise<DeviceCodeResponse> {
  // Setup timeout with AbortController
  const controller = new AbortController()
  const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(`${GITHUB_BASE_URL}/login/device/code`, {
      method: "POST",
      headers: standardHeaders(),
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: GITHUB_APP_SCOPES,
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new HTTPError("Failed to get device code", response)

    return (await response.json()) as DeviceCodeResponse
  } finally {
    clearTimeout(timeout)
  }
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}
