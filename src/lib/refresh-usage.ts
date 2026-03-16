import consola from "consola"

import { state } from "./state"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

// Cache configuration
const USAGE_CACHE_TTL_MS = 60 * 1000 // 1 minute cache
let lastUsageFetchTime = 0
let isFetching = false

/**
 * Refresh premium interactions usage information
 * with cache to avoid excessive API calls
 */
export async function refreshUsage(): Promise<void> {
  const now = Date.now()

  // Check if cache is still valid
  if (now - lastUsageFetchTime < USAGE_CACHE_TTL_MS) {
    consola.debug(
      `Using cached usage info (cached ${Math.floor((now - lastUsageFetchTime) / 1000)}s ago)`,
    )
    return
  }

  // Prevent concurrent fetches
  if (isFetching) {
    consola.debug("Usage fetch already in progress, skipping")
    return
  }

  try {
    isFetching = true
    consola.debug("Fetching latest usage information...")

    const usage = await getCopilotUsage()
    state.premiumInteractions = usage.quota_snapshots.premium_interactions

    lastUsageFetchTime = now

    const usagePercent = 100 - state.premiumInteractions.percent_remaining
    consola.debug(
      `✓ Usage refreshed: ${usagePercent.toFixed(1)}% (${state.premiumInteractions.remaining}/${state.premiumInteractions.entitlement} remaining)`,
    )
  } catch (error) {
    consola.warn("Failed to refresh usage information:", error)
    // Continue with existing state - don't block the main flow
  } finally {
    isFetching = false
  }
}

/**
 * Force refresh usage (bypass cache)
 */
export async function forceRefreshUsage(): Promise<void> {
  lastUsageFetchTime = 0
  await refreshUsage()
}

/**
 * Get current usage percentage
 */
export function getCurrentUsagePercent(): number | null {
  if (!state.premiumInteractions) {
    return null
  }
  return 100 - state.premiumInteractions.percent_remaining
}
