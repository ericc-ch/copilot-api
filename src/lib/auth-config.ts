import { z } from "zod"

/**
 * Schema for authentication configuration.
 * Supports single key via COPILOT_API_KEY or multiple keys via COPILOT_API_KEYS.
 */
export const authConfigSchema = z.object({
  /**
   * List of valid API keys. At least one key required when auth is enabled.
   */
  apiKeys: z.array(z.string().min(1)).default([]),

  /**
   * Whether authentication is enabled.
   * Defaults to true if any API keys are configured.
   */
  authEnabled: z.boolean().default(true),

  /**
   * Paths that bypass authentication (e.g., health checks).
   */
  skipAuthPaths: z.array(z.string()).default(["/", "/health"]),
})

export type AuthConfig = z.infer<typeof authConfigSchema>

/**
 * Parse API keys from environment variables.
 * Supports both COPILOT_API_KEY (single) and COPILOT_API_KEYS (comma-separated).
 */
export function parseApiKeysFromEnv(): Array<string> {
  const keys: Array<string> = []

  // Single key from COPILOT_API_KEY
  const singleKey = process.env.COPILOT_API_KEY
  if (singleKey && singleKey.trim().length > 0) {
    keys.push(singleKey.trim())
  }

  // Multiple keys from COPILOT_API_KEYS (comma-separated)
  const multipleKeys = process.env.COPILOT_API_KEYS
  if (multipleKeys) {
    const parsedKeys = multipleKeys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
    keys.push(...parsedKeys)
  }

  // Deduplicate keys
  return [...new Set(keys)]
}

/**
 * Create an AuthConfig from environment variables and CLI options.
 */
export function createAuthConfig(options?: {
  apiKey?: string
  noAuth?: boolean
}): AuthConfig {
  const envKeys = parseApiKeysFromEnv()

  // Add CLI-provided key if present
  const cliKey = options?.apiKey?.trim()
  const allKeys =
    cliKey && cliKey.length > 0 ? [...new Set([...envKeys, cliKey])] : envKeys

  // Auth is disabled if --no-auth flag is set, or if no keys are configured
  const authEnabled = options?.noAuth === true ? false : allKeys.length > 0

  return authConfigSchema.parse({
    apiKeys: allKeys,
    authEnabled,
    skipAuthPaths: ["/", "/health"],
  })
}
