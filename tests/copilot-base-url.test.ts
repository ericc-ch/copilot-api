import { describe, it, expect } from "bun:test"
import { copilotBaseUrl } from "../src/lib/api-config"
import type { State } from "../src/lib/state"

describe("copilotBaseUrl", () => {
  it("should return api.githubcopilot.com for individual account without enterprise", () => {
    const state: State = {
      accountType: "individual",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: undefined,
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://api.githubcopilot.com")
  })

  it("should return business endpoint for business account without enterprise", () => {
    const state: State = {
      accountType: "business",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: undefined,
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://api.business.githubcopilot.com")
  })

  it("should return enterprise endpoint for enterprise account without enterpriseUrl", () => {
    const state: State = {
      accountType: "enterprise",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: undefined,
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://api.enterprise.githubcopilot.com")
  })

  it("should return enterprise Copilot API endpoint when enterpriseUrl is set", () => {
    const state: State = {
      accountType: "individual",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: "ghe.example.com",
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://copilot-api.ghe.example.com")
  })

  it("should prioritize enterpriseUrl over accountType", () => {
    const state: State = {
      accountType: "business",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: "ghe.example.com",
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://copilot-api.ghe.example.com")
  })

  it("should handle enterprise URL with subdomain", () => {
    const state: State = {
      accountType: "individual",
      manualApprove: false,
      rateLimitWait: false,
      showToken: false,
      enterpriseUrl: "sub.ghe.example.com",
    }

    const url = copilotBaseUrl(state)
    expect(url).toBe("https://copilot-api.sub.ghe.example.com")
  })
})
