import consola from "consola"

import { addJitter, isRetryableError, RateLimitError } from "./retry"

interface QueueItem<T> {
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  timestamp: number
  retryCount: number
}

export class RequestQueue {
  private queue: Array<QueueItem<unknown>> = []
  private processing = false
  private rateLimitMs: number
  private lastProcessedTime = 0
  private maxRetries = 5 // Maximum number of retries for rate limit errors
  private requestTimeout = 60000 // 60s timeout per request

  // Adaptive rate limiting
  private successfulRequestsInRow = 0
  private rateLimitHitsInWindow = 0
  private rateLimitWindowStart = Date.now()
  private readonly rateLimitWindowMs = 60000 // 1 minute window
  private readonly successThresholdToDecrease = 20 // Decrease after 20 successful requests (conservative)
  private readonly minRateLimitMs = 100 // Minimum 100ms between requests
  private readonly decreaseFactor = 0.95 // Decrease by 5% when successful (conservative)
  private readonly maxRateLimitMs = 60000 // Maximum 60s between requests

  constructor(rateLimitSeconds?: number) {
    // Smart default: 1 second if not specified (adaptive rate limiting enabled)
    // Use 0 to explicitly disable rate limiting
    this.rateLimitMs =
      rateLimitSeconds !== undefined ? rateLimitSeconds * 1000 : 1000 // 1 second default
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    // Log warning if queue is getting large, but never reject
    if (this.queue.length > 100) {
      consola.warn(
        `Queue depth high: ${this.queue.length} requests waiting. Consider rate limiting.`,
      )
    }

    // If no rate limit is set, execute immediately with retry handling
    if (this.rateLimitMs === 0) {
      return this.executeWithRetry(execute, 0)
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
        retryCount: 0,
      })

      consola.debug(`Request queued. Queue size: ${this.queue.length}`)

      // Start processing if not already processing
      if (!this.processing) {
        void this.processQueue()
      }
    })
  }

  private async executeWithRetry<T>(
    execute: () => Promise<T>,
    retryCount: number,
  ): Promise<T> {
    try {
      // Execute with timeout
      return await this.executeWithTimeout(execute)
    } catch (error) {
      // Check if error is retryable
      if (!isRetryableError(error)) {
        consola.debug("Non-retryable error, failing immediately")
        throw error
      }

      if (retryCount >= this.maxRetries) {
        consola.error(`Max retries (${this.maxRetries}) exceeded`)
        throw error
      }

      // Handle rate limit errors with automatic retry
      if (error instanceof RateLimitError) {
        // Track rate limit hits for adaptive adjustment
        this.trackRateLimitHit()

        // Add jitter to prevent thundering herd
        const delayWithJitter = addJitter(error.retryInfo.retryAfter)
        const waitTimeMs = delayWithJitter * 1000

        consola.warn(
          `Rate limit hit (attempt ${retryCount + 1}/${this.maxRetries}). Waiting ${delayWithJitter.toFixed(1)}s before retry...`,
        )

        // Adaptively adjust rate limit based on 429 frequency
        this.adjustRateLimitUp(error.retryInfo.retryAfter)

        await new Promise((resolve) => setTimeout(resolve, waitTimeMs))

        consola.info(`Retrying request after rate limit wait...`)
        return this.executeWithRetry(execute, retryCount + 1)
      }

      // Handle other retryable errors (network errors, timeouts, 5xx)
      // Use exponential backoff with jitter
      const baseDelay = 1 // 1 second base
      const exponentialDelay = baseDelay * 2 ** retryCount // 1s, 2s, 4s, 8s, 16s
      const delayWithJitter = addJitter(exponentialDelay)
      const waitTimeMs = delayWithJitter * 1000

      const errorMessage =
        error instanceof Error ? error.message : String(error)
      consola.warn(
        `Transient error (attempt ${retryCount + 1}/${this.maxRetries}): ${errorMessage}. Waiting ${delayWithJitter.toFixed(1)}s before retry...`,
      )

      await new Promise((resolve) => setTimeout(resolve, waitTimeMs))

      consola.info(`Retrying request after transient error...`)
      return this.executeWithRetry(execute, retryCount + 1)
    }
  }

  private async executeWithTimeout<T>(execute: () => Promise<T>): Promise<T> {
    return Promise.race([
      execute(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Request timeout after ${this.requestTimeout}ms`)),
          this.requestTimeout,
        ),
      ),
    ])
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastProcessedTime

      // Wait if we need to respect rate limit
      if (
        this.lastProcessedTime > 0
        && timeSinceLastRequest < this.rateLimitMs
      ) {
        const waitTime = this.rateLimitMs - timeSinceLastRequest
        consola.info(
          `Rate limit: waiting ${Math.ceil(waitTime / 1000)}s before processing next request (${this.queue.length} in queue)`,
        )
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }

      const item = this.queue.shift()
      if (!item) break

      const queueTime = Date.now() - item.timestamp
      if (queueTime > 1000) {
        consola.debug(`Request waited ${Math.ceil(queueTime / 1000)}s in queue`)
      }

      try {
        consola.debug(
          `Processing request (${this.queue.length} remaining in queue)`,
        )
        const result = await this.executeWithRetry(
          item.execute,
          item.retryCount,
        )
        item.resolve(result)
        this.lastProcessedTime = Date.now()

        // Track successful request for adaptive rate limit decrease
        this.trackSuccessfulRequest()
      } catch (error) {
        // executeWithRetry already handles retries, so if we get here, all retries failed
        consola.error("Request failed after all retries:", error)
        item.reject(error)
        this.lastProcessedTime = Date.now()

        // Reset success counter on failure
        this.successfulRequestsInRow = 0
      }
    }

    this.processing = false
    consola.debug("Queue processing completed")
  }

  getQueueSize(): number {
    return this.queue.length
  }

  getCurrentRateLimitSeconds(): number {
    return this.rateLimitMs / 1000
  }

  getLastProcessedTime(): number {
    return this.lastProcessedTime
  }

  updateRateLimit(rateLimitSeconds?: number): void {
    this.rateLimitMs = rateLimitSeconds ? rateLimitSeconds * 1000 : 0
    consola.info(
      rateLimitSeconds ?
        `Rate limit updated to ${rateLimitSeconds}s`
      : "Rate limit disabled",
    )
  }

  /**
   * Track a rate limit hit (429 response) for adaptive adjustment
   */
  private trackRateLimitHit(): void {
    const now = Date.now()

    // Reset window if expired
    if (now - this.rateLimitWindowStart > this.rateLimitWindowMs) {
      this.rateLimitHitsInWindow = 0
      this.rateLimitWindowStart = now
    }

    this.rateLimitHitsInWindow++
    this.successfulRequestsInRow = 0 // Reset success counter
  }

  /**
   * Adjust rate limit UP (slow down) when hitting 429s
   * More aggressive if we're hitting many 429s in a short time
   */
  private adjustRateLimitUp(retryAfterSeconds: number): void {
    const suggestedRateLimitMs = retryAfterSeconds * 1000

    // If we're hitting many 429s, be more conservative (add buffer)
    let adjustedRateLimitMs = suggestedRateLimitMs
    if (this.rateLimitHitsInWindow > 2) {
      // Add 40% buffer if hitting rate limits frequently
      adjustedRateLimitMs = suggestedRateLimitMs * 1.4
      consola.debug(
        `Frequent rate limits detected (${this.rateLimitHitsInWindow} in last minute), adding 40% buffer`,
      )
    }

    // Only increase if the new limit is higher
    if (adjustedRateLimitMs > this.rateLimitMs) {
      const oldLimit = (this.rateLimitMs / 1000).toFixed(1)
      const newLimit = (adjustedRateLimitMs / 1000).toFixed(1)

      // Cap at maximum
      this.rateLimitMs = Math.min(adjustedRateLimitMs, this.maxRateLimitMs)

      consola.info(
        `Rate limit increased: ${oldLimit}s → ${newLimit}s (${this.rateLimitHitsInWindow} hits in last minute)`,
      )
    }
  }

  /**
   * Get adaptive decrease strategy based on distance from rate limit
   * More aggressive when far from limit, more cautious when close
   */
  private getDecreaseStrategy(): { threshold: number; factor: number } {
    if (this.rateLimitMs > 10000) {
      // Far from limit (>10s): be aggressive
      return { threshold: 10, factor: 0.9 } // 10% decrease after 10 successes
    }
    if (this.rateLimitMs > 2000) {
      // Medium distance (2-10s): be moderate
      return { threshold: 15, factor: 0.93 } // 7% decrease after 15 successes
    }
    // Close to limit (<2s): be very cautious (use defaults)
    return { threshold: 20, factor: 0.95 } // 5% decrease after 20 successes
  }

  /**
   * Track a successful request and potentially decrease rate limit (speed up)
   * Uses adaptive strategy based on distance from rate limit
   */
  private trackSuccessfulRequest(): void {
    this.successfulRequestsInRow++

    // Get adaptive strategy based on current rate limit
    const strategy = this.getDecreaseStrategy()

    // Only decrease if we have a rate limit set and we've had enough successes
    if (
      this.rateLimitMs > this.minRateLimitMs
      && this.successfulRequestsInRow >= strategy.threshold
    ) {
      const oldLimit = (this.rateLimitMs / 1000).toFixed(1)

      // Decrease rate limit using adaptive factor
      this.rateLimitMs = Math.max(
        this.minRateLimitMs,
        this.rateLimitMs * strategy.factor,
      )

      const newLimit = (this.rateLimitMs / 1000).toFixed(1)
      const decreasePercent = ((1 - strategy.factor) * 100).toFixed(0)

      consola.info(
        `Rate limit decreased: ${oldLimit}s → ${newLimit}s (${this.successfulRequestsInRow} consecutive successes, ${decreasePercent}% decrease)`,
      )

      // Reset counter after adjustment
      this.successfulRequestsInRow = 0
    }
  }
}
