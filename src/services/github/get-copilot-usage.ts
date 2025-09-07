import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const getCopilotUsage = async (): Promise<CopilotUsageResponse> => {
  // Setup timeout with AbortController
  const controller = new AbortController()
  const timeoutMs = state.timeoutMs ?? 120000 // Default to 2 minutes
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(
      `${GITHUB_API_BASE_URL}/copilot_internal/user`,
      {
        headers: githubHeaders(state),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      throw new HTTPError("Failed to get Copilot usage", response)
    }

    return (await response.json()) as CopilotUsageResponse
  } finally {
    clearTimeout(timeout)
  }
}

export interface QuotaDetail {
  entitlement: number
  overage_count: number
  overage_permitted: boolean
  percent_remaining: number
  quota_id: string
  quota_remaining: number
  remaining: number
  unlimited: boolean
}

interface QuotaSnapshots {
  chat: QuotaDetail
  completions: QuotaDetail
  premium_interactions: QuotaDetail
}

interface CopilotUsageResponse {
  access_type_sku: string
  analytics_tracking_id: string
  assigned_date: string
  can_signup_for_limited: boolean
  chat_enabled: boolean
  copilot_plan: string
  organization_login_list: Array<unknown>
  organization_list: Array<unknown>
  quota_reset_date: string
  quota_snapshots: QuotaSnapshots
}
