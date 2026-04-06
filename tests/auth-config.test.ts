import { describe, test, expect, beforeEach, afterEach } from "bun:test"

import {
  authConfigSchema,
  parseApiKeysFromEnv,
  createAuthConfig,
} from "../src/lib/auth-config"

describe("authConfigSchema", () => {
  test("parses valid config", () => {
    const config = authConfigSchema.parse({
      apiKeys: ["key1", "key2"],
      authEnabled: true,
      skipAuthPaths: ["/", "/health"],
    })

    expect(config.apiKeys).toEqual(["key1", "key2"])
    expect(config.authEnabled).toBe(true)
    expect(config.skipAuthPaths).toEqual(["/", "/health"])
  })

  test("uses defaults for missing fields", () => {
    const config = authConfigSchema.parse({})

    expect(config.apiKeys).toEqual([])
    expect(config.authEnabled).toBe(true)
    expect(config.skipAuthPaths).toEqual(["/", "/health"])
  })

  test("rejects empty string keys", () => {
    expect(() =>
      authConfigSchema.parse({
        apiKeys: [""],
      }),
    ).toThrow()
  })
})

describe("parseApiKeysFromEnv", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.COPILOT_API_KEY
    delete process.env.COPILOT_API_KEYS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("returns empty array when no env vars set", () => {
    expect(parseApiKeysFromEnv()).toEqual([])
  })

  test("parses single key from COPILOT_API_KEY", () => {
    process.env.COPILOT_API_KEY = "single-key"
    expect(parseApiKeysFromEnv()).toEqual(["single-key"])
  })

  test("parses multiple keys from COPILOT_API_KEYS", () => {
    process.env.COPILOT_API_KEYS = "key1,key2,key3"
    expect(parseApiKeysFromEnv()).toEqual(["key1", "key2", "key3"])
  })

  test("combines keys from both env vars", () => {
    process.env.COPILOT_API_KEY = "single-key"
    process.env.COPILOT_API_KEYS = "key1,key2"
    expect(parseApiKeysFromEnv()).toEqual(["single-key", "key1", "key2"])
  })

  test("deduplicates keys", () => {
    process.env.COPILOT_API_KEY = "shared-key"
    process.env.COPILOT_API_KEYS = "shared-key,other-key"
    expect(parseApiKeysFromEnv()).toEqual(["shared-key", "other-key"])
  })

  test("trims whitespace from keys", () => {
    process.env.COPILOT_API_KEYS = " key1 , key2 , key3 "
    expect(parseApiKeysFromEnv()).toEqual(["key1", "key2", "key3"])
  })

  test("filters out empty keys", () => {
    process.env.COPILOT_API_KEYS = "key1,,key2,,"
    expect(parseApiKeysFromEnv()).toEqual(["key1", "key2"])
  })

  test("ignores whitespace-only COPILOT_API_KEY", () => {
    process.env.COPILOT_API_KEY = "   "
    expect(parseApiKeysFromEnv()).toEqual([])
  })
})

describe("createAuthConfig", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.COPILOT_API_KEY
    delete process.env.COPILOT_API_KEYS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("creates config with CLI api key", () => {
    const config = createAuthConfig({ apiKey: "cli-key" })

    expect(config.apiKeys).toEqual(["cli-key"])
    expect(config.authEnabled).toBe(true)
  })

  test("combines CLI key with env keys", () => {
    process.env.COPILOT_API_KEY = "env-key"
    const config = createAuthConfig({ apiKey: "cli-key" })

    expect(config.apiKeys).toContain("cli-key")
    expect(config.apiKeys).toContain("env-key")
    expect(config.authEnabled).toBe(true)
  })

  test("disables auth with noAuth flag", () => {
    process.env.COPILOT_API_KEY = "env-key"
    const config = createAuthConfig({ noAuth: true })

    expect(config.authEnabled).toBe(false)
    expect(config.apiKeys).toEqual(["env-key"])
  })

  test("disables auth when no keys configured", () => {
    const config = createAuthConfig({})

    expect(config.authEnabled).toBe(false)
    expect(config.apiKeys).toEqual([])
  })

  test("deduplicates CLI key if same as env key", () => {
    process.env.COPILOT_API_KEY = "same-key"
    const config = createAuthConfig({ apiKey: "same-key" })

    expect(config.apiKeys).toEqual(["same-key"])
  })

  test("ignores empty CLI key", () => {
    const config = createAuthConfig({ apiKey: "" })

    expect(config.apiKeys).toEqual([])
    expect(config.authEnabled).toBe(false)
  })

  test("ignores whitespace CLI key", () => {
    const config = createAuthConfig({ apiKey: "   " })

    expect(config.apiKeys).toEqual([])
    expect(config.authEnabled).toBe(false)
  })

  test("sets default skipAuthPaths", () => {
    const config = createAuthConfig({ apiKey: "key" })

    expect(config.skipAuthPaths).toEqual(["/", "/health"])
  })
})
