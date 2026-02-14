import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createResponse } from "~/services/copilot/create-response"

// Copilot only supports "function" tools — strip built-in OpenAI tools
// like web_search, file_search, code_interpreter, computer_use_preview, etc.
function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(payload.tools)) return payload

  const supportedTools = (payload.tools as Array<{ type?: string }>).filter(
    (tool) => tool.type === "function",
  )

  const stripped = payload.tools.length - supportedTools.length
  if (stripped > 0) {
    consola.debug(`Stripped ${stripped} unsupported tool(s) from request`)
  }

  return {
    ...payload,
    tools: supportedTools.length > 0 ? supportedTools : undefined,
  }
}

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const rawPayload = await c.req.json<Record<string, unknown>>()
  consola.debug(
    "Responses API request payload:",
    JSON.stringify(rawPayload).slice(-400),
  )

  const payload = sanitizePayload(rawPayload)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createResponse(payload)

  // Non-streaming: forward the JSON response directly
  if (response instanceof Response) {
    const body = (await response.json()) as Record<string, unknown>
    consola.debug(
      "Non-streaming response from Copilot /responses:",
      JSON.stringify(body).slice(-400),
    )
    return c.json(body)
  }

  // Streaming: forward SSE events directly
  consola.debug("Streaming response from Copilot /responses")
  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      consola.debug(
        "Copilot /responses stream event:",
        rawEvent.data.slice(-300),
      )

      const parsed = JSON.parse(rawEvent.data) as { type?: string }
      const eventType = parsed.type ?? "unknown"

      await stream.writeSSE({
        event: eventType,
        data: rawEvent.data,
      })
    }
  })
}
