import consola from "consola"

export interface RateLimitInfo {
  limit?: number // Maximum requests allowed in the time window
  remaining?: number // Requests remaining in current window
  reset?: number // Unix timestamp when the limit resets
  retryAfter?: number // Seconds to wait (from Retry-After header)
}

/**
 * Parse rate limit headers from an API response.
 * Supports multiple header formats:
 * - X-RateLimit-* (GitHub style)
 * - RateLimit-* (RFC draft)
 * - Retry-After (for 429 responses)
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const info: RateLimitInfo = {}

  // Try X-RateLimit-* format first (GitHub style)
  const xLimit = headers.get("X-RateLimit-Limit")
  const xRemaining = headers.get("X-RateLimit-Remaining")
  const xReset = headers.get("X-RateLimit-Reset")

  if (xLimit) info.limit = Number.parseInt(xLimit, 10)
  if (xRemaining) info.remaining = Number.parseInt(xRemaining, 10)
  if (xReset) info.reset = Number.parseInt(xReset, 10)

  // Fall back to RateLimit-* format (RFC draft)
  if (!info.limit) {
    const limit = headers.get("RateLimit-Limit")
    if (limit) info.limit = Number.parseInt(limit, 10)
  }
  if (!info.remaining) {
    const remaining = headers.get("RateLimit-Remaining")
    if (remaining) info.remaining = Number.parseInt(remaining, 10)
  }
  if (!info.reset) {
    const reset = headers.get("RateLimit-Reset")
    if (reset) info.reset = Number.parseInt(reset, 10)
  }

  // Check Retry-After header (for 429 responses)
  const retryAfter = headers.get("Retry-After")
  if (retryAfter) {
    // Retry-After can be either seconds or HTTP date
    const retrySeconds = Number.parseInt(retryAfter, 10)
    if (!Number.isNaN(retrySeconds)) {
      info.retryAfter = retrySeconds
    } else {
      // Try parsing as HTTP date
      const retryDate = new Date(retryAfter)
      if (!Number.isNaN(retryDate.getTime())) {
        const secondsUntilRetry = Math.max(
          0,
          (retryDate.getTime() - Date.now()) / 1000,
        )
        info.retryAfter = secondsUntilRetry
      }
    }
  }

  return info
}

/**
 * Calculate the optimal delay in seconds based on rate limit information.
 * Returns undefined if no rate limit info is available (keeps current setting).
 *
 * Strategy:
 * - If retryAfter is present, use it directly
 * - If remaining and reset are present, distribute requests evenly
 * - Apply minimum delay of 0.1s and maximum of 60s
 */
export function calculateOptimalDelay(info: RateLimitInfo): number | undefined {
  // If Retry-After is specified, use it
  if (info.retryAfter !== undefined && info.retryAfter > 0) {
    const delay = Math.min(info.retryAfter, 60)
    consola.info(`Rate limit: Using Retry-After delay of ${delay.toFixed(1)}s`)
    return delay
  }

  // If we have remaining and reset, calculate even distribution
  if (
    info.remaining !== undefined
    && info.reset !== undefined
    && info.remaining >= 0
  ) {
    const now = Math.floor(Date.now() / 1000)
    const timeUntilReset = Math.max(0, info.reset - now)

    // If no requests remaining, wait until reset
    if (info.remaining === 0) {
      const delay = Math.min(timeUntilReset, 60)
      consola.warn(
        `Rate limit: No requests remaining, waiting ${delay.toFixed(1)}s until reset`,
      )
      return delay
    }

    // Distribute remaining requests evenly over time until reset
    // Add 1 to remaining to account for the current request
    const delay = timeUntilReset / (info.remaining + 1)

    // Apply bounds: minimum 0.1s, maximum 60s
    const boundedDelay = Math.max(0.1, Math.min(delay, 60))

    consola.info(
      `Rate limit: ${info.remaining} requests remaining in ${timeUntilReset}s, using ${boundedDelay.toFixed(1)}s delay`,
    )

    return boundedDelay
  }

  // No usable rate limit info
  return undefined
}

/**
 * Log rate limit information for debugging
 */
export function logRateLimitInfo(info: RateLimitInfo): void {
  if (
    info.limit === undefined
    && info.remaining === undefined
    && info.reset === undefined
    && info.retryAfter === undefined
  ) {
    consola.debug("No rate limit headers found in response")
    return
  }

  const parts: Array<string> = []
  if (info.limit !== undefined) parts.push(`limit: ${info.limit}`)
  if (info.remaining !== undefined) parts.push(`remaining: ${info.remaining}`)
  if (info.reset !== undefined) {
    const resetDate = new Date(info.reset * 1000)
    parts.push(`reset: ${resetDate.toISOString()}`)
  }
  if (info.retryAfter !== undefined) {
    parts.push(`retry-after: ${info.retryAfter}s`)
  }

  consola.debug(`Rate limit headers: ${parts.join(", ")}`)
}
