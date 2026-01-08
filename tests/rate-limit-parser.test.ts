import { describe, expect, test } from "bun:test"

import {
  calculateOptimalDelay,
  parseRateLimitHeaders,
  type RateLimitInfo,
} from "~/lib/rate-limit-parser"

describe("parseRateLimitHeaders", () => {
  test("parses X-RateLimit-* headers (GitHub/Copilot style)", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "5000",
      "X-RateLimit-Remaining": "4999",
      "X-RateLimit-Reset": "1704715200",
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(5000)
    expect(info.remaining).toBe(4999)
    expect(info.reset).toBe(1704715200)
  })

  test("parses RateLimit-* headers (RFC draft)", () => {
    const headers = new Headers({
      "RateLimit-Limit": "100",
      "RateLimit-Remaining": "50",
      "RateLimit-Reset": "1704715200",
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.limit).toBe(100)
    expect(info.remaining).toBe(50)
    expect(info.reset).toBe(1704715200)
  })

  test("parses Retry-After header with seconds", () => {
    const headers = new Headers({
      "Retry-After": "60",
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.retryAfter).toBe(60)
  })

  test("parses Retry-After header with HTTP date", () => {
    const futureDate = new Date(Date.now() + 60000) // 60 seconds in the future
    const headers = new Headers({
      "Retry-After": futureDate.toUTCString(),
    })

    const info = parseRateLimitHeaders(headers)

    expect(info.retryAfter).toBeGreaterThanOrEqual(59)
    expect(info.retryAfter).toBeLessThanOrEqual(61)
  })

  test("prioritizes X-RateLimit-* headers over RFC draft format", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "5000",
      "X-RateLimit-Remaining": "4999",
      "X-RateLimit-Reset": "1704715200",
      "RateLimit-Limit": "100",
      "RateLimit-Remaining": "50",
    })

    const info = parseRateLimitHeaders(headers)

    // Should use X-RateLimit-* values
    expect(info.limit).toBe(5000)
    expect(info.remaining).toBe(4999)
    expect(info.reset).toBe(1704715200)
  })

  test("falls back to RateLimit-* when X-RateLimit-* headers are missing", () => {
    const headers = new Headers({
      "RateLimit-Limit": "100",
      "RateLimit-Remaining": "50",
      "RateLimit-Reset": "1704715200",
    })

    const info = parseRateLimitHeaders(headers)

    // Should use RateLimit-* values
    expect(info.limit).toBe(100)
    expect(info.remaining).toBe(50)
    expect(info.reset).toBe(1704715200)
  })

  test("returns empty object when no rate limit headers are present", () => {
    const headers = new Headers()

    const info = parseRateLimitHeaders(headers)

    expect(info).toEqual({})
  })
})

describe("calculateOptimalDelay", () => {
  test("uses retryAfter when present", () => {
    const info: RateLimitInfo = {
      retryAfter: 30,
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBe(30)
  })

  test("caps retryAfter at 60 seconds", () => {
    const info: RateLimitInfo = {
      retryAfter: 120,
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBe(60)
  })

  test("calculates delay when no requests remaining", () => {
    const now = Math.floor(Date.now() / 1000)
    const info: RateLimitInfo = {
      remaining: 0,
      reset: now + 30, // 30 seconds until reset
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBeGreaterThanOrEqual(29)
    expect(delay).toBeLessThanOrEqual(31)
  })

  test("distributes remaining requests evenly", () => {
    const now = Math.floor(Date.now() / 1000)
    const info: RateLimitInfo = {
      remaining: 9, // 9 requests remaining
      reset: now + 100, // 100 seconds until reset
    }

    // With 9 remaining and adding 1 for current request = 10
    // 100 seconds / 10 requests = 10 seconds per request
    const delay = calculateOptimalDelay(info)

    expect(delay).toBe(10)
  })

  test("applies minimum delay of 0.1 seconds", () => {
    const now = Math.floor(Date.now() / 1000)
    const info: RateLimitInfo = {
      remaining: 1000,
      reset: now + 1, // 1 second until reset, lots of requests remaining
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBe(0.1)
  })

  test("applies maximum delay of 60 seconds", () => {
    const now = Math.floor(Date.now() / 1000)
    const info: RateLimitInfo = {
      remaining: 1,
      reset: now + 200, // 200 seconds until reset
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBe(60)
  })

  test("returns undefined when no usable rate limit info", () => {
    const info: RateLimitInfo = {}

    const delay = calculateOptimalDelay(info)

    expect(delay).toBeUndefined()
  })

  test("returns undefined when only limit is provided", () => {
    const info: RateLimitInfo = {
      limit: 1000,
    }

    const delay = calculateOptimalDelay(info)

    expect(delay).toBeUndefined()
  })
})
