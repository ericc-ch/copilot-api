import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const requestBody = c.req.raw.clone()
  const payload = await c.req.json<ResponsesPayload>()
  const body = await requestBody.text()
  consola.debug(
    "Responses request payload:",
    JSON.stringify(payload).slice(-400),
  )

  if (state.manualApprove) await awaitApproval()

  return createResponses(payload, body, c.req.raw.signal)
}
