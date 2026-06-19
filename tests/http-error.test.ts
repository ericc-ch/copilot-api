import { describe, expect, test } from "bun:test"

import { HTTPError, getHTTPErrorDetails } from "~/lib/error"

describe("HTTPError", () => {
  test("includes response status in the error message", () => {
    const error = new HTTPError(
      "Failed to get Copilot token",
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    )

    expect(error.message).toBe("Failed to get Copilot token (403 Forbidden)")
  })
})

describe("getHTTPErrorDetails", () => {
  test("parses JSON response bodies", async () => {
    const details = await getHTTPErrorDetails(
      new HTTPError(
        "Failed to get Copilot token",
        Response.json(
          {
            error_details: {
              message: "Your subscription has ended.",
              notification_id: "subscription_ended",
            },
          },
          { status: 403, statusText: "Forbidden" },
        ),
      ),
    )

    expect(details).toEqual({
      error_details: {
        message: "Your subscription has ended.",
        notification_id: "subscription_ended",
      },
    })
  })

  test("returns text response bodies", async () => {
    const details = await getHTTPErrorDetails(
      new HTTPError(
        "Failed to get Copilot token",
        new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
      ),
    )

    expect(details).toBe("Forbidden")
  })

  test("returns status details for empty response bodies", async () => {
    const details = await getHTTPErrorDetails(
      new HTTPError(
        "Failed to get Copilot token",
        new Response(null, { status: 403, statusText: "Forbidden" }),
      ),
    )

    expect(details).toEqual({
      status: 403,
      statusText: "Forbidden",
    })
  })
})
