import { describe, expect, test } from "bun:test"

import { getServerUrl } from "../src/start"

describe("getServerUrl", () => {
  test("uses localhost when listen address is omitted", () => {
    expect(getServerUrl(4141)).toBe("http://localhost:4141")
  })

  test("uses localhost when listening on all IPv4 interfaces", () => {
    expect(getServerUrl(4141, "0.0.0.0")).toBe("http://localhost:4141")
  })

  test("uses localhost when listening on all IPv6 interfaces", () => {
    expect(getServerUrl(4141, "::")).toBe("http://localhost:4141")
    expect(getServerUrl(4141, "[::]")).toBe("http://localhost:4141")
  })

  test("uses the configured address for loopback IPv4", () => {
    expect(getServerUrl(4141, "127.0.0.1")).toBe("http://127.0.0.1:4141")
  })

  test("formats IPv6 addresses correctly", () => {
    expect(getServerUrl(4141, "::1")).toBe("http://[::1]:4141")
  })
})
