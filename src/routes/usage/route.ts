import { Hono } from "hono"

import { getCopilotUsage } from "~/services/github/get-copilot-usage"

import { usageViewerHtml } from "./viewer"

export const usageRoute = new Hono()

usageRoute.get("/", async (c) => {
  // Content negotiation: serve HTML viewer to browsers, JSON to API clients.
  const accept = c.req.header("accept") ?? ""
  const wantsHtml =
    c.req.query("view") === "html"
    || (accept.includes("text/html") && !accept.includes("application/json"))

  if (wantsHtml) {
    return c.html(usageViewerHtml)
  }

  try {
    const usage = await getCopilotUsage()
    return c.json(usage)
  } catch (error) {
    console.error("Error fetching Copilot usage:", error)
    return c.json({ error: "Failed to fetch Copilot usage" }, 500)
  }
})

usageRoute.get("/view", (c) => c.html(usageViewerHtml))
