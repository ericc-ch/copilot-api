import consola from "consola"

import type { State } from "./state"

import { HTTPError } from "./error"
import { sleep } from "./utils"

/**
 * Execute a request with rate limiting using the request queue.
 * Requests are automatically queued and processed at the configured rate limit.
 * @param state - Application state containing the request queue
 * @param execute - The async function to execute
 * @returns The result of the executed function
 */
export async function executeWithRateLimit<T>(
  state: State,
  execute: () => Promise<T>,
): Promise<T> {
  return state.requestQueue.enqueue(execute)
}

/**
 * @deprecated Use executeWithRateLimit instead for better queue-based rate limiting
 */
export async function checkRateLimit(state: State) {
  if (state.rateLimitSeconds === undefined) return

  const now = Date.now()

  if (!state.lastRequestTimestamp) {
    state.lastRequestTimestamp = now
    return
  }

  const elapsedSeconds = (now - state.lastRequestTimestamp) / 1000

  if (elapsedSeconds > state.rateLimitSeconds) {
    state.lastRequestTimestamp = now
    return
  }

  const waitTimeSeconds = Math.ceil(state.rateLimitSeconds - elapsedSeconds)

  if (!state.rateLimitWait) {
    consola.warn(
      `Rate limit exceeded. Need to wait ${waitTimeSeconds} more seconds.`,
    )
    throw new HTTPError(
      "Rate limit exceeded",
      Response.json({ message: "Rate limit exceeded" }, { status: 429 }),
    )
  }

  const waitTimeMs = waitTimeSeconds * 1000
  consola.warn(
    `Rate limit reached. Waiting ${waitTimeSeconds} seconds before proceeding...`,
  )
  await sleep(waitTimeMs)
  // eslint-disable-next-line require-atomic-updates
  state.lastRequestTimestamp = now
  consola.info("Rate limit wait completed, proceeding with request")
  return
}
