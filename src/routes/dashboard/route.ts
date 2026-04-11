import { Hono } from "hono"

import { DASHBOARD_HTML } from "./page"

export const dashboardRoute = new Hono()

dashboardRoute.get("/", (c) => {
  return c.html(DASHBOARD_HTML)
})
