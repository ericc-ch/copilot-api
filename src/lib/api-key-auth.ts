import type { Context, MiddlewareHandler } from "hono"

import { HTTPException } from "hono/http-exception"

import { state } from "./state"

/**
 * Retrieve an API key from the incoming request.
 *
 * Checks common locations where clients supply keys (Authorization Bearer header, `x-api-key` header, or `apiKey` query parameter) and returns the first one found.
 *
 * @returns The extracted API key, or `undefined` if no key is present.
 */
function extractApiKey(c: Context): string | undefined {
  // OpenAI format: Authorization header with Bearer prefix
  const authHeader = c.req.header("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7) // Remove 'Bearer ' prefix
  }

  // Anthropic format: x-api-key header
  const anthropicKey = c.req.header("x-api-key")
  if (anthropicKey) {
    return anthropicKey
  }

  // Fallback: query parameter, for extra compatibility of `/usage` or `/token` route
  const queryKey = c.req.query("apiKey")
  if (queryKey) {
    return queryKey
  }

  return undefined
}

/**
 * API key authentication middleware
 * Validates that the request contains a valid API key if API keys are configured
 */
export const apiKeyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // If no API keys are configured, skip authentication
  if (!state.apiKeys || state.apiKeys.length === 0) {
    await next()
    return
  }

  const providedKey = extractApiKey(c)

  // If no API key is provided, return 401
  if (!providedKey) {
    throw new HTTPException(401, {
      message:
        "API key required. Please provide a valid API key in the Authorization header (Bearer token) or x-api-key header.",
    })
  }

  // Check if the provided key matches any of the configured keys
  const isValidKey = state.apiKeys.includes(providedKey)

  if (!isValidKey) {
    throw new HTTPException(401, {
      message: "Invalid API key. Please provide a valid API key.",
    })
  }

  // Key is valid, continue with the request
  await next()
}