import consola from "consola"

import {
  GITHUB_APP_SCOPES,
  GITHUB_BASE_URL,
  GITHUB_CLIENT_ID,
  standardHeaders,
} from "~/lib/api-config"
import { sleep } from "~/lib/utils"

interface AuthSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
  status: "pending" | "completed" | "expired" | "error"
  accessToken?: string
  error?: string
}

const sessions = new Map<string, AuthSession>()

export function getSession(sessionId: string): AuthSession | undefined {
  return sessions.get(sessionId)
}

export async function startDeviceFlow(): Promise<{
  sessionId: string
  userCode: string
  verificationUri: string
  expiresIn: number
}> {
  const response = await fetch(`${GITHUB_BASE_URL}/login/device/code`, {
    method: "POST",
    headers: standardHeaders(),
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_APP_SCOPES,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to get device code: ${response.status}`)
  }

  const data = (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  const sessionId = crypto.randomUUID()
  const session: AuthSession = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000,
    interval: data.interval,
    status: "pending",
  }

  sessions.set(sessionId, session)

  // Start background polling
  void pollForToken(sessionId, session)

  return {
    sessionId,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
  }
}

async function pollForToken(
  sessionId: string,
  session: AuthSession,
): Promise<void> {
  const sleepDuration = (session.interval + 1) * 1000

  while (session.status === "pending") {
    if (Date.now() > session.expiresAt) {
      session.status = "expired"
      session.error = "Device code expired"
      consola.warn(`Auth session ${sessionId} expired`)
      return
    }

    await sleep(sleepDuration)

    try {
      const response = await fetch(
        `${GITHUB_BASE_URL}/login/oauth/access_token`,
        {
          method: "POST",
          headers: standardHeaders(),
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: session.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        },
      )

      if (!response.ok) {
        consola.debug(`Auth poll failed: ${response.status}`)
        continue
      }

      const json = (await response.json()) as {
        access_token?: string
        error?: string
      }

      if (json.access_token) {
        // eslint-disable-next-line require-atomic-updates
        session.accessToken = json.access_token
        // eslint-disable-next-line require-atomic-updates
        session.status = "completed"
        consola.success(`Auth session ${sessionId} completed`)
        return
      }

      // "authorization_pending" or "slow_down" are expected
      if (json.error === "slow_down") {
        await sleep(5000)
      }
    } catch (error) {
      consola.debug("Auth poll error:", error)
    }
  }
}

export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId)
}
