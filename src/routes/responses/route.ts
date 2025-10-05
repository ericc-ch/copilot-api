import { Hono } from "hono"

import { forwardError } from "~/lib/error"

import { handleResponse } from "./handler"

export const responsesRoutes = new Hono()

responsesRoutes.post("/", async (c) => {
  try {
    return await handleResponse(c)
  } catch (error) {
    return await forwardError(c, error)
  }
})
