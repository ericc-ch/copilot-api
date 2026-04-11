export interface QuotaDetail {
  entitlement: number
  remaining: number
  percent_remaining: number
  unlimited: boolean
  over_limit?: boolean
}

/** Returns CSS hex color based on % used (100 - percent_remaining). */
export function getBudgetColor(percentUsed: number): string {
  if (percentUsed >= 95) return "#ef4444"
  if (percentUsed >= 80) return "#f59e0b"
  return "#22c55e"
}

/** Computes percentage used (0–100) from a QuotaDetail. Returns 0 for unlimited. */
export function getPercentUsed(quota: QuotaDetail): number {
  if (quota.unlimited) return 0
  if (quota.entitlement === 0) return 0
  return Math.min(
    100,
    ((quota.entitlement - quota.remaining) / quota.entitlement) * 100,
  )
}

/** Returns a human-readable label for a quota key. */
export function getQuotaLabel(key: string): string {
  const labels: Record<string, string> = {
    premium_interactions: "Premium Interactions",
    chat: "Chat",
    completions: "Completions",
  }
  return (
    labels[key]
    ?? key.replaceAll("_", " ").replaceAll(/\b\w/g, (c) => c.toUpperCase())
  )
}
