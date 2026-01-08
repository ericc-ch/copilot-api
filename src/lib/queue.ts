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

  constructor(rateLimitSeconds?: number) {
    this.rateLimitMs = rateLimitSeconds ? rateLimitSeconds * 1000 : 0
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
        // Add jitter to prevent thundering herd
        const delayWithJitter = addJitter(error.retryInfo.retryAfter)
        const waitTimeMs = delayWithJitter * 1000

        consola.warn(
          `Rate limit hit (attempt ${retryCount + 1}/${this.maxRetries}). Waiting ${delayWithJitter.toFixed(1)}s before retry...`,
        )

        // Dynamically adjust rate limit if needed
        if (error.retryInfo.retryAfter > this.rateLimitMs / 1000) {
          this.updateRateLimit(error.retryInfo.retryAfter)
        }

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
      } catch (error) {
        // executeWithRetry already handles retries, so if we get here, all retries failed
        consola.error("Request failed after all retries:", error)
        item.reject(error)
        this.lastProcessedTime = Date.now()
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
}
