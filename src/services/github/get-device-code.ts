import {
  GITHUB_APP_SCOPES,
  GITHUB_CLIENT_ID,
  githubBaseUrl,
  standardHeaders,
} from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export async function getDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(`${githubBaseUrl(state)}/login/device/code`, {
    method: "POST",
    headers: standardHeaders(),
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_APP_SCOPES,
    }),
  })

  if (!response.ok) throw new HTTPError("Failed to get device code", response)

  return (await response.json()) as DeviceCodeResponse
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}
