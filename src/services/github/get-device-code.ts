import {
  GITHUB_APP_SCOPES,
  GITHUB_CLIENT_ID,
  standardHeaders,
  GITHUB_BASE_URL,
} from "~/lib/api-config"
import { HTTPError } from "~/lib/error"

export async function getDeviceCode(
  enterpriseUrl?: string,
): Promise<DeviceCodeResponse> {
  const base =
    typeof GITHUB_BASE_URL === "function" ?
      GITHUB_BASE_URL(enterpriseUrl)
    : GITHUB_BASE_URL
  const response = await fetch(`${base}/login/device/code`, {
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
