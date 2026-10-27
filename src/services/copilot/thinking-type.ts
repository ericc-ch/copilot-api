// Copilot rejects some thinking types per model with HTTP 400 and names the
// type that it accepts, in one of two message shapes:
//   "thinking.type.disabled" is not supported ... Use "thinking.type.adaptive" ...
//   send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}
const REPLACEMENT_PATTERN =
  /send "thinking": \{"type": "(?<accepted>[a-z_]+)"\} instead of \{"type": "(?<rejected>[a-z_]+)"\}/
const REJECTED_PATTERN =
  /"thinking\.type\.(?<rejected>[a-z_]+)" is not supported/
const ACCEPTED_PATTERN = /Use "thinking\.type\.(?<accepted>[a-z_]+)"/

export interface ThinkingRejection {
  rejected: string
  accepted: string | undefined
}

function readErrorMessage(errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as { error?: { message?: unknown } }
    const message = parsed.error?.message
    return typeof message === "string" ? message : errorBody
  } catch {
    return errorBody
  }
}

export function parseThinkingRejection(
  errorBody: string,
): ThinkingRejection | undefined {
  const message = readErrorMessage(errorBody)
  const replacement = REPLACEMENT_PATTERN.exec(message)?.groups
  const rejected =
    replacement?.rejected ?? REJECTED_PATTERN.exec(message)?.groups?.rejected
  if (!rejected) return undefined
  const accepted =
    replacement?.accepted ?? ACCEPTED_PATTERN.exec(message)?.groups?.accepted
  return { rejected, accepted }
}

// A client picks the thinking type from the model ID that it knows. A router
// can map that ID to a Copilot model with other rules. This keeps, per
// upstream model, the type to send instead of a requested type.
export interface ThinkingRequest {
  model: string
  requested: string
}

class ThinkingTypeReplacements {
  readonly #byModel = new Map<string, Map<string, string>>()

  typeToSend({ model, requested }: ThinkingRequest): string {
    return this.#byModel.get(model)?.get(requested) ?? requested
  }

  // Call after HTTP 400. Forgets a replacement that Copilot now rejects and
  // returns the type that the error names, if there is one.
  retryType(
    { model, requested }: ThinkingRequest,
    sent: string,
    errorBody: string,
  ): string | undefined {
    const rejection = parseThinkingRejection(errorBody)
    if (rejection?.rejected !== sent) return undefined
    this.#byModel.get(model)?.delete(requested)
    return rejection.accepted === sent ? undefined : rejection.accepted
  }

  // Call after a retry with `accepted` succeeds.
  remember({ model, requested }: ThinkingRequest, accepted: string): void {
    if (accepted === requested) return
    const replacements = this.#byModel.get(model) ?? new Map<string, string>()
    replacements.set(requested, accepted)
    this.#byModel.set(model, replacements)
  }

  // The cache lives for the process. Tests reset it between cases.
  clear(): void {
    this.#byModel.clear()
  }
}

export const thinkingTypeReplacements = new ThinkingTypeReplacements()
