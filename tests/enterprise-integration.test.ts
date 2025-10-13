import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { getDeviceCode } from "../src/services/github/get-device-code"
import { pollAccessToken } from "../src/services/github/poll-access-token"
import { getCopilotToken } from "../src/services/github/get-copilot-token"
import { getCopilotUsage } from "../src/services/github/get-copilot-usage"
import { getGitHubUser } from "../src/services/github/get-user"
import { state } from "../src/lib/state"

describe("Enterprise OAuth Integration", () => {
  const originalFetch = global.fetch
  let fetchCalls: Array<{ url: string; options?: any }> = []

  beforeEach(() => {
    fetchCalls = []
    state.enterpriseUrl = undefined
    state.githubToken = "test-github-token"
    state.copilotToken = "test-copilot-token"
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe("getDeviceCode", () => {
    it("should use github.com when no enterprise URL", async () => {
      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              device_code: "test_device",
              user_code: "ABCD-1234",
              verification_uri: "https://github.com/login/device",
              expires_in: 900,
              interval: 5,
            }),
        })
      }) as any

      await getDeviceCode()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe("https://github.com/login/device/code")
    })

    it("should use enterprise URL when provided", async () => {
      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              device_code: "test_device",
              user_code: "ABCD-1234",
              verification_uri: "https://ghe.example.com/login/device",
              expires_in: 900,
              interval: 5,
            }),
        })
      }) as any

      await getDeviceCode("ghe.example.com")

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://ghe.example.com/login/device/code",
      )
    })

    it("should normalize enterprise URL with https prefix", async () => {
      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              device_code: "test_device",
              user_code: "ABCD-1234",
              verification_uri: "https://ghe.example.com/login/device",
              expires_in: 900,
              interval: 5,
            }),
        })
      }) as any

      await getDeviceCode("https://ghe.example.com/")

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://ghe.example.com/login/device/code",
      )
    })
  })

  describe("pollAccessToken", () => {
    const deviceCodeResponse = {
      device_code: "test_device",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    }

    it("should use github.com when no enterprise URL", async () => {
      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: "gho_test",
              token_type: "bearer",
              scope: "read:user",
            }),
        })
      }) as any

      await pollAccessToken(deviceCodeResponse)

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://github.com/login/oauth/access_token",
      )
    })

    it("should use enterprise URL when provided", async () => {
      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: "gho_test",
              token_type: "bearer",
              scope: "read:user",
            }),
        })
      }) as any

      await pollAccessToken(deviceCodeResponse, "ghe.example.com")

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://ghe.example.com/login/oauth/access_token",
      )
    })
  })

  describe("getCopilotToken", () => {
    it("should use api.github.com when no enterprise URL", async () => {
      state.enterpriseUrl = undefined

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: "copilot_token",
              expires_at: Date.now() + 3600000,
              refresh_in: 3000,
            }),
        })
      }) as any

      await getCopilotToken()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/copilot_internal/v2/token",
      )
    })

    it("should use enterprise API URL when configured", async () => {
      state.enterpriseUrl = "ghe.example.com"

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: "copilot_token",
              expires_at: Date.now() + 3600000,
              refresh_in: 3000,
            }),
        })
      }) as any

      await getCopilotToken()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://api.ghe.example.com/copilot_internal/v2/token",
      )
    })
  })

  describe("getCopilotUsage", () => {
    it("should use api.github.com when no enterprise URL", async () => {
      state.enterpriseUrl = undefined

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              copilot_plan: "individual",
              quota_snapshots: {
                chat: { remaining: 100 },
                completions: { remaining: 100 },
              },
            }),
        })
      }) as any

      await getCopilotUsage()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/copilot_internal/user",
      )
    })

    it("should use enterprise API URL when configured", async () => {
      state.enterpriseUrl = "ghe.example.com"

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              copilot_plan: "enterprise",
              quota_snapshots: {
                chat: { remaining: 100 },
                completions: { remaining: 100 },
              },
            }),
        })
      }) as any

      await getCopilotUsage()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe(
        "https://api.ghe.example.com/copilot_internal/user",
      )
    })
  })

  describe("getGitHubUser", () => {
    it("should use api.github.com when no enterprise URL", async () => {
      state.enterpriseUrl = undefined

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              login: "testuser",
            }),
        })
      }) as any

      await getGitHubUser()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe("https://api.github.com/user")
    })

    it("should use enterprise API URL when configured", async () => {
      state.enterpriseUrl = "ghe.example.com"

      global.fetch = mock((url: string, options?: any) => {
        fetchCalls.push({ url, options })
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              login: "enterpriseuser",
            }),
        })
      }) as any

      await getGitHubUser()

      expect(fetchCalls.length).toBe(1)
      expect(fetchCalls[0].url).toBe("https://api.ghe.example.com/user")
    })
  })
})
