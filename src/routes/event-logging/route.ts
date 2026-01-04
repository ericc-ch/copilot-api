import { Hono } from "hono"

export const eventLoggingRoutes = new Hono()

// Anthropic telemetry log (ignore, just return 200)
eventLoggingRoutes.post("/batch", (c) => {
  return c.text("OK", 200)
})
