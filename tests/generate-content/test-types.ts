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

// Tool cleanup expectations
export interface ToolCleanupExpectation {
  noDuplicates?: boolean
  noEmptyFunctions?: boolean
}

// Translation test case schema
export interface TranslationCase {
  name: string
  input: {
    contents: Array<{
      role: string
      parts: Array<{ text?: string; functionCall?: unknown }>
    }>
    tools?: Array<unknown>
    systemInstruction?: unknown
  }
  expect: {
    messageCount?: number
    roles?: Array<string>
    toolCount?: number
    hasToolCalls?: boolean
  }
}

// SSE-related types
export interface SSEEvent {
  event?: string
  data: string
}

export interface SSEMatcher {
  text?: string
  finishReason?: string
  usageMetadata?: boolean
  toolCall?: {
    name: string
    hasArgs?: boolean
    completeArgs?: boolean
  }
  textMatch?: {
    pattern: string | RegExp
    minOccurrences?: number
  }
  jsonContains?: string
}
