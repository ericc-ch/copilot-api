import { describe, expect, test } from "bun:test"

import {
  getBudgetColor,
  getPercentUsed,
  getQuotaLabel,
} from "~/routes/dashboard/budget"

describe("getBudgetColor", () => {
  test("returns green below 80%", () => {
    expect(getBudgetColor(0)).toBe("#22c55e")
    expect(getBudgetColor(50)).toBe("#22c55e")
    expect(getBudgetColor(79.9)).toBe("#22c55e")
  })

  test("returns yellow at 80%", () => {
    expect(getBudgetColor(80)).toBe("#f59e0b")
    expect(getBudgetColor(85)).toBe("#f59e0b")
    expect(getBudgetColor(94.9)).toBe("#f59e0b")
  })

  test("returns red at 95%", () => {
    expect(getBudgetColor(95)).toBe("#ef4444")
    expect(getBudgetColor(99)).toBe("#ef4444")
    expect(getBudgetColor(100)).toBe("#ef4444")
  })
})

describe("getPercentUsed", () => {
  test("returns 0 for unlimited quota", () => {
    expect(
      getPercentUsed({
        entitlement: 1000,
        remaining: 200,
        percent_remaining: 20,
        unlimited: true,
      }),
    ).toBe(0)
  })

  test("returns 0 for zero entitlement", () => {
    expect(
      getPercentUsed({
        entitlement: 0,
        remaining: 0,
        percent_remaining: 0,
        unlimited: false,
      }),
    ).toBe(0)
  })

  test("calculates correct percent used", () => {
    expect(
      getPercentUsed({
        entitlement: 1000,
        remaining: 800,
        percent_remaining: 80,
        unlimited: false,
      }),
    ).toBe(20)
    expect(
      getPercentUsed({
        entitlement: 100,
        remaining: 5,
        percent_remaining: 5,
        unlimited: false,
      }),
    ).toBe(95)
    expect(
      getPercentUsed({
        entitlement: 100,
        remaining: 0,
        percent_remaining: 0,
        unlimited: false,
      }),
    ).toBe(100)
  })

  test("caps at 100% when over limit", () => {
    expect(
      getPercentUsed({
        entitlement: 100,
        remaining: -10,
        percent_remaining: 0,
        unlimited: false,
      }),
    ).toBe(100)
  })
})

describe("getQuotaLabel", () => {
  test("returns friendly label for known keys", () => {
    expect(getQuotaLabel("premium_interactions")).toBe("Premium Interactions")
    expect(getQuotaLabel("chat")).toBe("Chat")
    expect(getQuotaLabel("completions")).toBe("Completions")
  })

  test("capitalizes unknown keys", () => {
    expect(getQuotaLabel("some_quota")).toBe("Some Quota")
  })
})
