import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

import { RateLimitError } from "./retry"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

  // Handle rate limit errors with detailed retry information
  if (error instanceof RateLimitError) {
    const retryAfter = error.retryInfo.retryAfter
    const message =
      error.retryInfo.exceeded ?
        `Rate limit exceeded: ${error.retryInfo.exceeded}. Retry after ${retryAfter} seconds.`
      : `Rate limit exceeded. Retry after ${retryAfter} seconds.`

    return c.json(
      {
        error: {
          message,
          type: "rate_limit_error",
          retry_after: retryAfter,
          exceeded: error.retryInfo.exceeded,
        },
      },
      429,
      {
        "Retry-After": retryAfter.toString(),
      },
    )
  }

  if (error instanceof HTTPError) {
    const errorText = await error.response.text()
    let errorJson: unknown
    try {
      errorJson = JSON.parse(errorText)
    } catch {
      errorJson = errorText
    }
    consola.error("HTTP error:", errorJson)
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
