import consola from "consola"

interface QueueItem<T> {
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  timestamp: number
}

export class RequestQueue {
  private queue: Array<QueueItem<unknown>> = []
  private processing = false
  private rateLimitMs: number
  private lastProcessedTime = 0

  constructor(rateLimitSeconds?: number) {
    this.rateLimitMs = rateLimitSeconds ? rateLimitSeconds * 1000 : 0
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    // If no rate limit is set, execute immediately
    if (this.rateLimitMs === 0) {
      return execute()
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
      })

      consola.debug(`Request queued. Queue size: ${this.queue.length}`)

      // Start processing if not already processing
      if (!this.processing) {
        void this.processQueue()
      }
    })
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
        const result = await item.execute()
        item.resolve(result)
      } catch (error) {
        consola.error("Error processing queued request:", error)
        item.reject(error)
      }

      this.lastProcessedTime = Date.now()
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
