import { describe, test, expect, beforeEach } from "bun:test"
import { Hono } from "hono"

import {
  extractApiKey,
  secureCompare,
  isValidApiKey,
  shouldSkipAuth,
  authMiddleware,
} from "../src/lib/auth-middleware"
import { state } from "../src/lib/state"

interface ErrorResponse {
  error: {
    message: string
    type: string
  }
}

interface SuccessResponse {
  success: boolean
}

interface KeyResponse {
  key: string | null
}

interface StatusResponse {
  status: string
}

describe("extractApiKey", () => {
  test("extracts key from Authorization Bearer header", async () => {
    const app = new Hono()
    app.get("/test", (c) => {
      const key = extractApiKey(c)
      return c.json({ key })
    })

    const req = new Request("http://localhost/test", {
      headers: { Authorization: "Bearer my-api-key" },
    })

    const res = await app.fetch(req)
    const json = (await res.json()) as KeyResponse
    expect(json.key).toBe("my-api-key")
  })

  test("extracts key from x-api-key header", async () => {
    const app = new Hono()
    app.get("/test", (c) => {
      const key = extractApiKey(c)
      return c.json({ key })
    })

    const req = new Request("http://localhost/test", {
      headers: { "x-api-key": "my-api-key" },
    })

    const res = await app.fetch(req)
    const json = (await res.json()) as KeyResponse
    expect(json.key).toBe("my-api-key")
  })

  test("prefers Authorization header over x-api-key", async () => {
    const app = new Hono()
    app.get("/test", (c) => {
      const key = extractApiKey(c)
      return c.json({ key })
    })

    const req = new Request("http://localhost/test", {
      headers: {
        Authorization: "Bearer auth-key",
        "x-api-key": "x-api-key-value",
      },
    })

    const res = await app.fetch(req)
    const json = (await res.json()) as KeyResponse
    expect(json.key).toBe("auth-key")
  })

  test("returns null when no key provided", async () => {
    const app = new Hono()
    app.get("/test", (c) => {
      const key = extractApiKey(c)
      return c.json({ key })
    })

    const req = new Request("http://localhost/test")

    const res = await app.fetch(req)
    const json = (await res.json()) as KeyResponse
    expect(json.key).toBeNull()
  })

  test("handles case-insensitive Bearer", async () => {
    const app = new Hono()
    app.get("/test", (c) => {
      const key = extractApiKey(c)
      return c.json({ key })
    })

    const req = new Request("http://localhost/test", {
      headers: { Authorization: "bearer my-api-key" },
    })

    const res = await app.fetch(req)
    const json = (await res.json()) as KeyResponse
    expect(json.key).toBe("my-api-key")
  })
})

describe("secureCompare", () => {
  test("returns true for equal strings", () => {
    expect(secureCompare("secret", "secret")).toBe(true)
  })

  test("returns false for different strings", () => {
    expect(secureCompare("secret", "secre")).toBe(false)
  })

  test("returns false for strings of different lengths", () => {
    expect(secureCompare("abc", "abcd")).toBe(false)
  })

  test("returns true for empty strings", () => {
    expect(secureCompare("", "")).toBe(true)
  })

  test("returns false for completely different strings of same length", () => {
    expect(secureCompare("aaaa", "bbbb")).toBe(false)
  })
})

describe("isValidApiKey", () => {
  test("returns true when key matches one of valid keys", () => {
    expect(isValidApiKey("key1", ["key1", "key2", "key3"])).toBe(true)
    expect(isValidApiKey("key2", ["key1", "key2", "key3"])).toBe(true)
  })

  test("returns false when key does not match any valid key", () => {
    expect(isValidApiKey("invalid", ["key1", "key2"])).toBe(false)
  })

  test("returns false for empty valid keys array", () => {
    expect(isValidApiKey("key", [])).toBe(false)
  })
})

describe("shouldSkipAuth", () => {
  test("returns true for root path", () => {
    expect(shouldSkipAuth("/", ["/", "/health"])).toBe(true)
  })

  test("returns true for health path", () => {
    expect(shouldSkipAuth("/health", ["/", "/health"])).toBe(true)
  })

  test("returns false for protected path", () => {
    expect(shouldSkipAuth("/v1/chat/completions", ["/", "/health"])).toBe(false)
  })

  test("handles trailing slashes", () => {
    expect(shouldSkipAuth("/health/", ["/", "/health"])).toBe(true)
  })
})

describe("authMiddleware", () => {
  beforeEach(() => {
    // Reset state before each test
    state.authEnabled = false
    state.apiKeys = []
    state.skipAuthPaths = ["/", "/health"]
  })

  test("allows request when auth is disabled", async () => {
    state.authEnabled = false

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as SuccessResponse
    expect(json.success).toBe(true)
  })

  test("allows request to skip paths when auth is enabled", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/", (c) => c.text("ok"))

    const req = new Request("http://localhost/")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
  })

  test("returns 401 when no API key provided", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected")
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const json = (await res.json()) as ErrorResponse
    expect(json.error.message).toBe("Authentication required")
    expect(json.error.type).toBe("authentication_error")
  })

  test("returns 401 when invalid API key provided", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected", {
      headers: { Authorization: "Bearer wrong-key" },
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const json = (await res.json()) as ErrorResponse
    expect(json.error.message).toBe("Invalid API key")
  })

  test("allows request with valid API key in Authorization header", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected", {
      headers: { Authorization: "Bearer valid-key" },
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as SuccessResponse
    expect(json.success).toBe(true)
  })

  test("allows request with valid API key in x-api-key header", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected", {
      headers: { "x-api-key": "valid-key" },
    })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as SuccessResponse
    expect(json.success).toBe(true)
  })

  test("supports multiple valid API keys", async () => {
    state.authEnabled = true
    state.apiKeys = ["key1", "key2", "key3"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    // Test with first key
    const req1 = new Request("http://localhost/protected", {
      headers: { Authorization: "Bearer key1" },
    })
    const res1 = await app.fetch(req1)
    expect(res1.status).toBe(200)

    // Test with second key
    const req2 = new Request("http://localhost/protected", {
      headers: { Authorization: "Bearer key2" },
    })
    const res2 = await app.fetch(req2)
    expect(res2.status).toBe(200)

    // Test with third key
    const req3 = new Request("http://localhost/protected", {
      headers: { Authorization: "Bearer key3" },
    })
    const res3 = await app.fetch(req3)
    expect(res3.status).toBe(200)
  })

  test("allows request when no API keys configured but auth enabled", async () => {
    state.authEnabled = true
    state.apiKeys = []

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/protected", (c) => c.json({ success: true }))

    const req = new Request("http://localhost/protected")
    const res = await app.fetch(req)

    // Should allow through with a warning (edge case)
    expect(res.status).toBe(200)
  })

  test("health endpoint bypasses auth", async () => {
    state.authEnabled = true
    state.apiKeys = ["valid-key"]

    const app = new Hono()
    app.use(authMiddleware)
    app.get("/health", (c) => c.json({ status: "ok" }))

    const req = new Request("http://localhost/health")
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const json = (await res.json()) as StatusResponse
    expect(json.status).toBe("ok")
  })
})
