import consola from "consola"

export interface RetryInfo {
  retryAfter: number // seconds to wait
  exceeded?: string // what limit was exceeded
}

/**
 * Parse Retry-After header from response
 * Can be either seconds (number) or HTTP date (string)
 */
export function parseRetryAfter(response: Response): RetryInfo | null {
  const retryAfter = response.headers.get("retry-after")
  const exceeded = response.headers.get("x-ratelimit-exceeded")
  const userRetryAfter = response.headers.get("x-ratelimit-user-retry-after")

  // Prefer x-ratelimit-user-retry-after if available
  const retryValue = userRetryAfter || retryAfter

  if (!retryValue) {
    return null
  }

  // Try parsing as number (seconds)
  const retrySeconds = Number.parseInt(retryValue, 10)
  if (!Number.isNaN(retrySeconds)) {
    return {
      retryAfter: retrySeconds,
      exceeded: exceeded || undefined,
    }
  }

  // Try parsing as HTTP date
  const retryDate = new Date(retryValue)
  if (!Number.isNaN(retryDate.getTime())) {
    const secondsUntilRetry = Math.max(
      0,
      Math.ceil((retryDate.getTime() - Date.now()) / 1000),
    )
    return {
      retryAfter: secondsUntilRetry,
      exceeded: exceeded || undefined,
    }
  }

  return null
}

/**
 * Rate limit error with retry information
 */
export class RateLimitError extends Error {
  retryInfo: RetryInfo

  constructor(message: string, retryInfo: RetryInfo) {
    super(message)
    this.name = "RateLimitError"
    this.retryInfo = retryInfo
  }
}

/**
 * Check if a response is a rate limit error and parse retry info
 */
export function checkRateLimitError(response: Response): RateLimitError | null {
  if (response.status !== 429) {
    return null
  }

  const retryInfo = parseRetryAfter(response)
  if (!retryInfo) {
    // 429 without retry info
    return new RateLimitError("Rate limit exceeded", { retryAfter: 60 })
  }

  let message = `Rate limit exceeded. Retry after ${retryInfo.retryAfter}s`
  if (retryInfo.exceeded) {
    message += ` (${retryInfo.exceeded})`
  }

  consola.warn(message)

  return new RateLimitError(message, retryInfo)
}
