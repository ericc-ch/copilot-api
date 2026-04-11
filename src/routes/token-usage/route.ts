import { Hono } from "hono"

import { getTokenUsageData } from "~/lib/token-store"

const RANGE_MAP: Record<string, number> = {
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
}

export const tokenUsageRoute = new Hono()

tokenUsageRoute.get("/", (c) => {
  const rangeParam = c.req.query("range") ?? "24h"
  const rangeSeconds = RANGE_MAP[rangeParam] ?? RANGE_MAP["24h"]

  const result = getTokenUsageData(rangeSeconds)
  return c.json(result)
})
