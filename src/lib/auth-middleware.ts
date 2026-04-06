import type { Context, Next } from "hono"

import consola from "consola"

import { state } from "./state"

/**
 * Extracts API key from request headers.
 * Supports both "Authorization: Bearer <key>" and "x-api-key: <key>" formats.
 */
export function extractApiKey(c: Context): string | null {
  // Check Authorization header first (Bearer token)
  const authHeader = c.req.header("Authorization")
  if (authHeader) {
    // Use simple startsWith check instead of regex to avoid backtracking
    const lowerHeader = authHeader.toLowerCase()
    if (lowerHeader.startsWith("bearer ")) {
      return authHeader.slice(7).trim()
    }
  }

  // Check x-api-key header
  const xApiKey = c.req.header("x-api-key")
  if (xApiKey) {
    return xApiKey
  }

  return null
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0)
  }
  return result === 0
}

/**
 * Check if the provided key matches any of the valid API keys.
 */
export function isValidApiKey(key: string, validKeys: Array<string>): boolean {
  return validKeys.some((validKey) => secureCompare(key, validKey))
}

/**
 * Check if a path should skip authentication.
 */
export function shouldSkipAuth(
  path: string,
  skipPaths: ReadonlyArray<string>,
): boolean {
  // Normalize path by removing trailing slash (except for root)
  const normalizedPath = path === "/" ? "/" : path.replace(/\/$/, "")
  return skipPaths.includes(normalizedPath)
}

/**
 * Hono middleware for API key authentication.
 * Validates requests against configured API keys in state.
 */
export async function authMiddleware(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  // Skip if auth is disabled
  if (!state.authEnabled) {
    await next()
    return
  }

  // Skip auth for configured paths (health checks)
  const skipPaths = state.skipAuthPaths
  if (shouldSkipAuth(c.req.path, skipPaths)) {
    await next()
    return
  }

  // Check if any API keys are configured
  const apiKeys = state.apiKeys
  if (apiKeys.length === 0) {
    // No keys configured but auth enabled - this shouldn't happen
    // but we'll allow the request through with a warning
    consola.warn("Auth enabled but no API keys configured")
    await next()
    return
  }

  // Extract and validate API key
  const providedKey = extractApiKey(c)

  if (!providedKey) {
    consola.debug("Auth failed: No API key provided")
    return c.json(
      {
        error: {
          message: "Authentication required",
          type: "authentication_error",
        },
      },
      401,
    )
  }

  if (!isValidApiKey(providedKey, apiKeys)) {
    consola.debug("Auth failed: Invalid API key")
    return c.json(
      {
        error: {
          message: "Invalid API key",
          type: "authentication_error",
        },
      },
      401,
    )
  }

  // Key is valid, proceed
  await next()
}
