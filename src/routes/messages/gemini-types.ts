// Gemini API Types

export interface GeminiRequest {
  contents: Array<GeminiContent>
  tools?: Array<GeminiTool>
  toolConfig?: GeminiToolConfig
  safetySettings?: Array<GeminiSafetySetting>
  systemInstruction?: GeminiContent
  generationConfig?: GeminiGenerationConfig
}

export interface GeminiContent {
  parts: Array<GeminiPart>
  role?: "user" | "model"
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart

export interface GeminiTextPart {
  text: string
}

export interface GeminiInlineDataPart {
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
  functionDeclarations: Array<GeminiFunctionDeclaration>
}

export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface GeminiToolConfig {
  functionCallingConfig: {
    mode: "AUTO" | "ANY" | "NONE"
    allowedFunctionNames?: Array<string>
  }
}

export interface GeminiSafetySetting {
  category: string
  threshold: string
}

export interface GeminiGenerationConfig {
  stopSequences?: Array<string>
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
}

// Response types
export interface GeminiResponse {
  candidates: Array<GeminiCandidate>
  usageMetadata?: GeminiUsageMetadata
}

export interface GeminiCandidate {
  content: GeminiContent
  finishReason?:
    | "FINISH_REASON_UNSPECIFIED"
    | "STOP"
    | "MAX_TOKENS"
    | "SAFETY"
    | "RECITATION"
    | "OTHER"
  index: number
  safetyRatings?: Array<GeminiSafetyRating>
}

export interface GeminiSafetyRating {
  category: string
  probability: string
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
