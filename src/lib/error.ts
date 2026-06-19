import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(`${message} (${response.status} ${response.statusText})`)
    this.response = response
  }
}

export async function getHTTPErrorDetails(error: HTTPError): Promise<unknown> {
  const errorText = await error.response.clone().text()

  if (!errorText) {
    return {
      status: error.response.status,
      statusText: error.response.statusText,
    }
  }

  try {
    return JSON.parse(errorText) as unknown
  } catch {
    return errorText
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

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
