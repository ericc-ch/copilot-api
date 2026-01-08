import consola from "consola"

import { RateLimitError } from "./retry"

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

  constructor(rateLimitSeconds?: number) {
    this.rateLimitMs = rateLimitSeconds ? rateLimitSeconds * 1000 : 0
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
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
      return await execute()
    } catch (error) {
      // Handle rate limit errors with automatic retry
      if (error instanceof RateLimitError) {
        if (retryCount >= this.maxRetries) {
          consola.error(
            `Max retries (${this.maxRetries}) exceeded for rate limit error`,
          )
          throw error
        }

        const waitTimeMs = error.retryInfo.retryAfter * 1000
        consola.warn(
          `Rate limit hit (attempt ${retryCount + 1}/${this.maxRetries}). Waiting ${error.retryInfo.retryAfter}s before retry...`,
        )

        // Dynamically adjust rate limit if needed
        if (error.retryInfo.retryAfter > this.rateLimitMs / 1000) {
          this.updateRateLimit(error.retryInfo.retryAfter)
        }

        await new Promise((resolve) => setTimeout(resolve, waitTimeMs))

        consola.info(`Retrying request after rate limit wait...`)
        return this.executeWithRetry(execute, retryCount + 1)
      }

      // Re-throw non-rate-limit errors
      throw error
    }
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
        // If it's a rate limit error and we can retry, re-queue it
        if (
          error instanceof RateLimitError
          && item.retryCount < this.maxRetries
        ) {
          const waitTimeMs = error.retryInfo.retryAfter * 1000
          consola.warn(
            `Re-queuing request after rate limit (attempt ${item.retryCount + 1}/${this.maxRetries}). Will retry in ${error.retryInfo.retryAfter}s`,
          )

          // Dynamically adjust rate limit if needed
          if (error.retryInfo.retryAfter > this.rateLimitMs / 1000) {
            this.updateRateLimit(error.retryInfo.retryAfter)
          }

          // Wait and re-queue at the front
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
          this.queue.unshift({
            ...item,
            retryCount: item.retryCount + 1,
            timestamp: Date.now(),
          })
          consola.info(
            `Request re-queued for retry (${this.queue.length} in queue)`,
          )
        } else {
          consola.error("Error processing queued request:", error)
          item.reject(error)
          this.lastProcessedTime = Date.now()
        }
      }
    }

    this.processing = false
    consola.debug("Queue processing completed")
  }

  getQueueSize(): number {
    return this.queue.length
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
