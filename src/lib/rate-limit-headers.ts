import type { Context } from "hono"

import type { State } from "./state"

/**
 * Add rate limit headers to response
 * These headers inform clients about rate limiting status
 */
export function addRateLimitHeaders(c: Context, state: State): void {
  const queue = state.requestQueue
  const rateLimitSeconds = queue.getCurrentRateLimitSeconds()

  // X-RateLimit-Limit: Maximum requests per period
  // If rate limit is set, it's 1 request per N seconds, so limit = 60/N per minute
  if (rateLimitSeconds > 0) {
    const limit = Math.floor(60 / rateLimitSeconds)
    c.header("X-RateLimit-Limit", limit.toString())
  }

  // X-RateLimit-Remaining: Requests remaining (based on queue depth)
  // If queue is empty, remaining = limit; otherwise, it's decreasing
  const queueSize = queue.getQueueSize()
  if (rateLimitSeconds > 0) {
    const limit = Math.floor(60 / rateLimitSeconds)
    const remaining = Math.max(0, limit - queueSize)
    c.header("X-RateLimit-Remaining", remaining.toString())
  } else {
    // No rate limit, always "unlimited"
    c.header("X-RateLimit-Remaining", "1000")
  }

  // X-RateLimit-Reset: Unix timestamp when rate limit resets
  // Calculate based on last processed time + rate limit interval
  const lastProcessed = queue.getLastProcessedTime()
  if (rateLimitSeconds > 0 && lastProcessed > 0) {
    const resetTime = Math.floor(
      (lastProcessed + rateLimitSeconds * 1000) / 1000,
    )
    c.header("X-RateLimit-Reset", resetTime.toString())
  }

  // X-Queue-Depth: Custom header showing current queue size
  c.header("X-Queue-Depth", queueSize.toString())

  // Retry-After: Only set if queue is large (suggest client to slow down)
  if (queueSize > 50 && rateLimitSeconds > 0) {
    c.header("Retry-After", Math.ceil(rateLimitSeconds).toString())
  }
}
