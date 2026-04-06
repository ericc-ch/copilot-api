import { describe, test, expect, beforeAll } from "bun:test"
import { Hono } from "hono"

import { createAuthConfig } from "../src/lib/auth-config"
import { authMiddleware } from "../src/lib/auth-middleware"
import { state } from "../src/lib/state"

describe("Integration: Auth with Environment API Keys", () => {
  beforeAll(() => {
    // Configure state with auth from environment
    const config = createAuthConfig()
    state.authEnabled = config.authEnabled
    state.apiKeys = config.apiKeys
    state.skipAuthPaths = config.skipAuthPaths

    console.log(
      `\nConfigured ${state.apiKeys.length} API keys from environment`,
    )
  })

  test("parses all 4 API keys from COPILOT_API_KEYS", () => {
    expect(state.apiKeys.length).toBe(4)
    expect(state.authEnabled).toBe(true)
  })

  test("health endpoints bypass auth", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/", (c) => c.text("OK"))
    app.get("/health", (c) => c.json({ status: "ok" }))

    const res1 = await app.fetch(new Request("http://localhost/"))
    expect(res1.status).toBe(200)

    const res2 = await app.fetch(new Request("http://localhost/health"))
    expect(res2.status).toBe(200)
  })

  test("rejects request without API key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(new Request("http://localhost/v1/models"))
    expect(res.status).toBe(401)
  })

  test("rejects request with invalid API key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { Authorization: "Bearer invalid-key" },
      }),
    )
    expect(res.status).toBe(401)
  })

  test("accepts request with first valid API key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { Authorization: `Bearer ${state.apiKeys[0]}` },
      }),
    )
    expect(res.status).toBe(200)
  })

  test("accepts request with second valid API key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { Authorization: `Bearer ${state.apiKeys[1]}` },
      }),
    )
    expect(res.status).toBe(200)
  })

  test("accepts request with third valid API key via x-api-key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { "x-api-key": state.apiKeys[2] },
      }),
    )
    expect(res.status).toBe(200)
  })

  test("accepts request with fourth valid API key", async () => {
    const app = new Hono()
    app.use(authMiddleware)
    app.get("/v1/models", (c) => c.json({ models: [] }))

    const res = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { Authorization: `Bearer ${state.apiKeys[3]}` },
      }),
    )
    expect(res.status).toBe(200)
  })
})
