export type CopilotMessagesEndpoint =
  | "/v1/messages"
  | "/responses"
  | "/chat/completions"

export function selectCopilotMessagesEndpoint(
  supportedEndpoints: Array<string> | undefined,
): CopilotMessagesEndpoint | null {
  if (!supportedEndpoints) return "/chat/completions"
  if (supportedEndpoints.includes("/v1/messages")) return "/v1/messages"
  if (supportedEndpoints.includes("/responses")) return "/responses"
  if (supportedEndpoints.includes("/chat/completions")) {
    return "/chat/completions"
  }
  return null
}
