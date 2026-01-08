import consola from "consola"
import { createHash } from "node:crypto"

interface CacheEntry<T> {
  response: T
  timestamp: number
}

/**
 * Simple in-memory cache for request deduplication
 * Caches identical requests to reduce GitHub API calls
 */
export class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private readonly ttlMs: number
  private readonly maxSize: number

  constructor(ttlSeconds = 30, maxSize = 1000) {
    this.ttlMs = ttlSeconds * 1000
    this.maxSize = maxSize
  }

  /**
   * Generate cache key from request payload
   */
  private generateKey(payload: unknown): string {
    const hash = createHash("sha256")
    hash.update(JSON.stringify(payload))
    return hash.digest("hex")
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > this.ttlMs
  }

  /**
   * Get cached response if available and not expired
   */
  get(payload: unknown): unknown {
    const key = this.generateKey(payload)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key)
      consola.debug(`Cache expired for key: ${key.slice(0, 8)}...`)
      return null
    }

    consola.debug(
      `Cache hit for key: ${key.slice(0, 8)}... (age: ${Math.round((Date.now() - entry.timestamp) / 1000)}s)`,
    )
    return entry.response
  }

  /**
   * Store response in cache
   */
  set(payload: unknown, response: unknown): void {
    // Evict old entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
        consola.debug("Cache full, evicted oldest entry")
      }
    }

    const key = this.generateKey(payload)
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    })
    consola.debug(`Cached response for key: ${key.slice(0, 8)}...`)
  }

  /**
   * Clear all expired entries
   */
  cleanup(): void {
    let count = 0
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key)
        count++
      }
    }
    if (count > 0) {
      consola.debug(`Cleaned up ${count} expired cache entries`)
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttlSeconds: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlSeconds: this.ttlMs / 1000,
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear()
    consola.info("Cache cleared")
  }
}
