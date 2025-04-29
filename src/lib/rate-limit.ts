import consola from "consola"

import type { State } from "./state"

import { HTTPError } from "./http-error"
import { sleep } from "./sleep"

/**
 * Checks if the request rate limit has been hit based on the configured
 * `rateLimitSeconds` and `lastRequestTimestamp` in the global state.
 * If hit, it either throws a 429 HTTPError or waits (sleeps) before
 * returning, depending on the `rateLimitWait` state flag.
 *
 * @param state - The global application state.
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
