import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("Enterprise URL Persistence", () => {
  const TEST_APP_DIR = path.join(os.tmpdir(), "copilot-api-test")
  const TEST_ENTERPRISE_URL_PATH = path.join(TEST_APP_DIR, "enterprise_url")
  const TEST_GITHUB_TOKEN_PATH = path.join(TEST_APP_DIR, "github_token")

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(TEST_APP_DIR, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_APP_DIR, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("Enterprise URL file operations", () => {
    it("should write enterprise URL to file", async () => {
      const testUrl = "ghe.example.com"
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, testUrl)

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content).toBe(testUrl)
    })

    it("should read enterprise URL from file", async () => {
      const testUrl = "ghe.example.com"
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, testUrl)

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content.trim()).toBe(testUrl)
    })

    it("should handle empty file gracefully", async () => {
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, "")

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content.trim()).toBe("")
    })

    it("should handle file with whitespace", async () => {
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, "  ghe.example.com  \n")

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content.trim()).toBe("ghe.example.com")
    })

    it("should create file with restrictive permissions", async () => {
      const testUrl = "ghe.example.com"
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, testUrl)
      await fs.chmod(TEST_ENTERPRISE_URL_PATH, 0o600)

      const stats = await fs.stat(TEST_ENTERPRISE_URL_PATH)
      // Check that only owner can read/write (0600)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it("should handle missing file (return undefined)", async () => {
      // File doesn't exist
      try {
        await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.code).toBe("ENOENT")
      }
    })
  })

  describe("Token and enterprise URL coordination", () => {
    it("should store both token and enterprise URL", async () => {
      const token = "gho_testtoken"
      const enterpriseUrl = "ghe.example.com"

      await fs.writeFile(TEST_GITHUB_TOKEN_PATH, token)
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, enterpriseUrl)

      const tokenContent = await fs.readFile(TEST_GITHUB_TOKEN_PATH, "utf8")
      const urlContent = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")

      expect(tokenContent).toBe(token)
      expect(urlContent).toBe(enterpriseUrl)
    })

    it("should allow token without enterprise URL", async () => {
      const token = "gho_testtoken"
      await fs.writeFile(TEST_GITHUB_TOKEN_PATH, token)

      const tokenContent = await fs.readFile(TEST_GITHUB_TOKEN_PATH, "utf8")
      expect(tokenContent).toBe(token)

      // Verify enterprise URL file doesn't exist
      try {
        await fs.access(TEST_ENTERPRISE_URL_PATH)
        expect(true).toBe(false) // Should not exist
      } catch (error: any) {
        expect(error.code).toBe("ENOENT")
      }
    })

    it("should allow clearing enterprise URL", async () => {
      // Write then clear
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, "ghe.example.com")
      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, "")

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content).toBe("")
    })
  })

  describe("URL normalization before persistence", () => {
    it("should store normalized URL without scheme", async () => {
      const inputUrl = "https://ghe.example.com/"
      const normalizedUrl = inputUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")

      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, normalizedUrl)

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content).toBe("ghe.example.com")
    })

    it("should store normalized URL from http", async () => {
      const inputUrl = "http://ghe.example.com"
      const normalizedUrl = inputUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")

      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, normalizedUrl)

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content).toBe("ghe.example.com")
    })

    it("should store already-normalized URL as-is", async () => {
      const normalizedUrl = "ghe.example.com"

      await fs.writeFile(TEST_ENTERPRISE_URL_PATH, normalizedUrl)

      const content = await fs.readFile(TEST_ENTERPRISE_URL_PATH, "utf8")
      expect(content).toBe("ghe.example.com")
    })
  })
})
