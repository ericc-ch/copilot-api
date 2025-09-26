// Gemini API Types

export interface GeminiRequest {
  contents: Array<GeminiContent>
  tools?: Array<GeminiTool>
  toolConfig?: GeminiToolConfig
  safetySettings?: Array<Record<string, unknown>>
  systemInstruction?: GeminiContent
  generationConfig?: Record<string, unknown>
}

export interface GeminiContent {
  parts: Array<GeminiPart>
  role?: "user" | "model"
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart
  | GeminiInlineDataPart

export interface GeminiTextPart {
  text: string
}

interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string
    data: string
  }
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string
    args: Record<string, unknown>
  }
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string
    response: Record<string, unknown>
  }
}

export interface GeminiTool {
  functionDeclarations?: Array<GeminiFunctionDeclaration>
  googleSearch?: Record<string, unknown>
  urlContext?: Record<string, unknown>
}

interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  parametersJsonSchema?: Record<string, unknown>
}

interface GeminiToolConfig {
  functionCallingConfig: {
    mode: "AUTO" | "ANY" | "NONE"
    allowedFunctionNames?: Array<string>
  }
}

// Response types
export interface GeminiResponse {
  candidates: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
  promptFeedback?: Record<string, unknown>
}

export interface GeminiCandidate {
  content: GeminiContent
  finishReason?:
    | "FINISH_REASON_UNSPECIFIED"
    | "STOP"
    | "MAX_TOKENS"
    | "SAFETY"
    | "RECITATION"
    | "LANGUAGE"
    | "OTHER"
    | "BLOCKLIST"
    | "PROHIBITED_CONTENT"
    | "SPII"
    | "MALFORMED_FUNCTION_CALL"
    | "IMAGE_SAFETY"
    | "UNEXPECTED_TOOL_CALL"
    | "TOO_MANY_TOOL_CALLS"
  index: number
  safetyRatings?: Array<Record<string, unknown>>
}

export interface GeminiUsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

// Token counting types
export interface GeminiCountTokensRequest {
  contents: Array<GeminiContent>
  tools?: Array<GeminiTool>
  systemInstruction?: GeminiContent
}

export interface GeminiCountTokensResponse {
  totalTokens: number
}

// Streaming types
export interface GeminiStreamResponse {
  candidates?: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
}
