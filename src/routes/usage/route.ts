import { Hono } from "hono"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

export const usageRoute = new Hono()

usageRoute.get("/", async (c) => {
  try {
    const usage = await getCopilotUsage()
    return c.json(usage)
  } catch (error) {
    console.error("Error fetching Copilot usage:", error)
    return c.json(
      { error: "Failed to fetch Copilot usage" },
      500
    )
  }
})
