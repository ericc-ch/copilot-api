import { GITHUB_API_BASE_URL, githubHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export interface CopilotUsageResponse {
  copilot_plan: string
  access_type_sku: string
  assigned_date: string
  chat_enabled: boolean
  quota_reset_date: string
  can_signup_for_limited: boolean
  organization_list: string[]
  quota_snapshots: {
    [key: string]: {
      unlimited: boolean
      remaining: number
      entitlement: number
      overage_count: number
      percent_remaining: number
    }
  }
}

export const getCopilotUsage = async (): Promise<CopilotUsageResponse> => {
  const response = await fetch(
    `${GITHUB_API_BASE_URL}/copilot_internal/user`,
    {
      headers: githubHeaders(state),
    },
  )

  if (!response.ok) {
    throw new HTTPError("Failed to get Copilot usage", response)
  }

  return (await response.json()) as CopilotUsageResponse
}
