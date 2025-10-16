import { Hono } from "hono"

import { register } from "~/lib/metrics"

export const metricsRoute = new Hono()

metricsRoute.get("/", async (c) => {
  const metrics = await register.metrics()
  return c.text(metrics, 200, {
    "Content-Type": register.contentType,
  })
})
