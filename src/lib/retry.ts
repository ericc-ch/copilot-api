import consola from "consola"

export interface RetryInfo {
  retryAfter: number // seconds to wait
  exceeded?: string // what limit was exceeded
}

/**
 * Add jitter to a delay to prevent thundering herd
 * @param delaySeconds - Base delay in seconds
 * @param jitterPercent - Jitter percentage (0.1 = ±10%)
 * @returns Delay with jitter applied in seconds
 */
export function addJitter(delaySeconds: number, jitterPercent = 0.2): number {
  const jitter = delaySeconds * jitterPercent * (Math.random() - 0.5) * 2
  return Math.max(0.1, delaySeconds + jitter)
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
 * Check if an HTTP status code indicates a transient error that should be retried
 */
export function isTransientError(statusCode: number): boolean {
  // Retry on:
  // - 429 (rate limit - handled specially)
  // - 500 (internal server error)
  // - 502 (bad gateway)
  // - 503 (service unavailable)
  // - 504 (gateway timeout)
  return (
    statusCode === 429
    || statusCode === 500
    || statusCode === 502
    || statusCode === 503
    || statusCode === 504
  )
}

/**
 * Check if an error is retryable (network errors, timeouts, transient errors)
 */
export function isRetryableError(error: unknown): boolean {
  // Rate limit errors are always retryable
  if (error instanceof RateLimitError) {
    return true
  }

  // Check HTTPError status codes
  // Note: We need to import HTTPError here, but to avoid circular deps,
  // we'll check for the response property instead
  if (
    error
    && typeof error === "object"
    && "response" in error
    && error.response instanceof Response
  ) {
    return isTransientError(error.response.status)
  }

  // Timeout errors are retryable
  if (error instanceof Error && error.message.includes("timeout")) {
    return true
  }

  // Network errors are retryable (ECONNRESET, ETIMEDOUT, etc.)
  if (
    error instanceof Error
    && (error.message.includes("ECONNRESET")
      || error.message.includes("ETIMEDOUT")
      || error.message.includes("ENOTFOUND")
      || error.message.includes("ECONNREFUSED")
      || error.message.includes("fetch failed"))
  ) {
    return true
  }

  return false
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
