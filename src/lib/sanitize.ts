/**
 * Sanitizes JSON payloads by removing ANSI escape sequences and invisible Unicode characters
 * that can cause GitHub Copilot API to return 400 Bad Request errors.
 */

/**
 * Removes ANSI escape sequences and problematic Unicode characters from a string
 */
export function sanitizeString(str: string): string {
  return (
    str
      // Remove ANSI escape sequences (e.g., \x1b[31m, \x1b[0m, etc.)
      // eslint-disable-next-line no-control-regex
      .replaceAll(/\x1b\[[0-9;]*[a-z]/gi, "")
      // Remove other ANSI sequences that might use different patterns
      // eslint-disable-next-line no-control-regex
      .replaceAll(/\x1b\[[0-9;]*m/g, "")
      // eslint-disable-next-line no-control-regex
      .replaceAll(/\x1b\[[\d;]*[HfA-DsuJKmhlp]/g, "")
      // Remove other control characters except newlines (\n), tabs (\t), and carriage returns (\r)
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[\x00-\x08\v\f\x0E-\x1F\x7F]/g, "")
      // Remove invisible Unicode characters
      .replaceAll(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width spaces, BOM
      .replaceAll(/[\u2060-\u2064]/g, "") // Word joiner, invisible separator
      .replaceAll(/[\u206A-\u206F]/g, "") // Various invisible formatting characters
      // Remove other problematic invisible characters
      .replaceAll(/[\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, "") // Various space characters
      // Remove any remaining non-printable characters that might cause JSON parsing issues
      .replaceAll(/[\uFFF0-\uFFFF]/g, "")
  ) // Specials block
}

/**
 * Recursively sanitizes all string values in an object or array
 */
export function sanitizePayload<T>(payload: T): T {
  if (typeof payload === "string") {
    return sanitizeString(payload) as T
  }

  if (Array.isArray(payload)) {
    return payload.map((item: unknown) => sanitizePayload(item)) as T
  }

  if (payload && typeof payload === "object") {
    const sanitized = {} as Record<string, unknown>
    for (const [key, value] of Object.entries(payload)) {
      sanitized[key] = sanitizePayload(value)
    }
    return sanitized as T
  }

  return payload
}
