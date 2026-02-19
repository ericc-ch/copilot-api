import { describe, it, expect } from "bun:test"

import {
  normalizeDomain,
  githubBaseUrl,
  githubApiBaseUrl,
} from "../src/lib/url"

describe("URL helpers", () => {
  describe("normalizeDomain", () => {
    it("returns undefined for empty/undefined input", () => {
      expect(normalizeDomain(undefined)).toBe(undefined)
      expect(normalizeDomain("")).toBe(undefined)
    })

    it("strips https:// prefix", () => {
      expect(normalizeDomain("https://ghe.example.com")).toBe("ghe.example.com")
    })

    it("strips http:// prefix", () => {
      expect(normalizeDomain("http://ghe.example.com")).toBe("ghe.example.com")
    })

    it("strips trailing slashes", () => {
      expect(normalizeDomain("ghe.example.com/")).toBe("ghe.example.com")
      expect(normalizeDomain("https://ghe.example.com///")).toBe(
        "ghe.example.com",
      )
    })

    it("handles already normalized domains", () => {
      expect(normalizeDomain("ghe.example.com")).toBe("ghe.example.com")
      expect(normalizeDomain("sub.ghe.example.com")).toBe("sub.ghe.example.com")
    })
  })

  describe("githubBaseUrl", () => {
    it("returns github.com URL when no enterprise provided", () => {
      expect(githubBaseUrl()).toBe("https://github.com")
      expect(githubBaseUrl(undefined)).toBe("https://github.com")
    })

    it("returns enterprise URL when enterprise provided", () => {
      expect(githubBaseUrl("ghe.example.com")).toBe("https://ghe.example.com")
      expect(githubBaseUrl("https://ghe.example.com/")).toBe(
        "https://ghe.example.com",
      )
    })
  })

  describe("githubApiBaseUrl", () => {
    it("returns api.github.com URL when no enterprise provided", () => {
      expect(githubApiBaseUrl()).toBe("https://api.github.com")
      expect(githubApiBaseUrl(undefined)).toBe("https://api.github.com")
    })

    it("returns enterprise API URL when enterprise provided", () => {
      expect(githubApiBaseUrl("ghe.example.com")).toBe(
        "https://api.ghe.example.com",
      )
      expect(githubApiBaseUrl("https://ghe.example.com/")).toBe(
        "https://api.ghe.example.com",
      )
    })
  })
})
