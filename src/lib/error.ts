import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

  if (error instanceof HTTPError) {
    const cloned = error.response.clone()
    let errorText = ""
    let errorJson = null
    try {
      errorJson = await cloned.json()
      consola.error("HTTP error:", errorJson)
      errorText = typeof errorJson === 'string' ? errorJson : JSON.stringify(errorJson)
    } catch {
      try {
        errorText = await cloned.text()
        consola.error("HTTP error text:", errorText)
      } catch {
        errorText = "Failed to read error response"
        consola.error("Failed to read error response body")
      }
    }
    return c.json(
      {
        error: {
          message: errorText,
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
    )
  }

  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}
