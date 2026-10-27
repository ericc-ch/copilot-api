// Error messages returned by Copilot /v1/messages on 2026-10-27.
// Opus 5.5, Sonnet 5.5 and Haiku 5.5 return the same text for "enabled".
export const ENABLED_REJECTED =
  '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
export const OPUS_DISABLED_REJECTED =
  '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
export const SONNET_DISABLED_REJECTED =
  'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding.'
export const BETWEEN_TOOLS_REJECTED =
  '"thinking.type.between_tools" is not supported for this model.'

export function errorBody(message: string): string {
  return JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message },
  })
}
