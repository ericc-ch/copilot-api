import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

// Test utility types
export interface TestServer {
  request: (
    url: string,
    options: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<Response>
}

export interface MockChatCompletionsModule {
  createChatCompletions: (
    payload: ChatCompletionsPayload,
  ) => ChatCompletionResponse | AsyncIterable<{ data: string }>
}

export interface MockRateLimitModule {
  checkRateLimit: (payload: unknown) => void
}

export interface MockTokenCountModule {
  getTokenCount: () => { input: number; output: number }
}

// Common test data types
export interface CapturedPayload extends Record<string, unknown> {
  messages?: Array<{
    role: string
    content: string
    tool_calls?: Array<{
      id: string
      type: string
      function: { name: string; arguments: string }
    }>
    tool_call_id?: string
  }>
  tools?: Array<{
    type: string
    function: { name: string; parameters: Record<string, unknown> }
  }>
  tool_choice?: string
  model?: string
}

// Gemini request types for tests
export interface GeminiTestRequest {
  contents: Array<{
    role: "user" | "model"
    parts: Array<
      | { text: string }
      | { functionCall: { name: string; args: Record<string, unknown> } }
      | {
          functionResponse: { name: string; response: Record<string, unknown> }
        }
    >
  }>
  tools?: Array<{
    functionDeclarations?: Array<{
      name: string
      parameters: { type: string; properties?: Record<string, unknown> }
    }>
    urlContext?: Record<string, unknown>
  }>
  toolConfig?: {
    functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE" }
  }
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  model?: string
}
