import type { Context } from "hono"

import consola from "consola"
import { streamSSE, SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createResponses } from "~/services/copilot/create-responses"

export async function handleResponse(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json()
  consola.debug("Request payload:", JSON.stringify(payload))

  if (state.manualApprove) await awaitApproval()

  const response = await createResponses(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

function isNonStreaming(response) { return false; }
// function isNonStreaming(response: any) {
//   return !response || typeof response[Symbol.asyncIterator] !== 'function';
// }
// const isNonStreaming = (
//   response: Awaited<ReturnType<typeof createChatCompletions>>,
// ): response is ResponsesResponse => Object.hasOwn(response, )
