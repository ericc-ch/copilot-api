import { Hono } from "hono"
import { state } from "~/lib/state"

export const tokenRoute = new Hono()

tokenRoute.get("/", async (c) => {
  try {
    return c.json({
      token: state.copilotToken || "No token available",
      hasToken: !!state.copilotToken
    })
  } catch (error) {
    console.error("Error fetching token:", error)
    return c.json(
      { error: "Failed to fetch token", token: null },
      500
    )
  }
})
