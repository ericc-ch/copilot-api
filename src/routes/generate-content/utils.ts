import { type GeminiCandidate } from "./types"

export function mapOpenAIFinishReasonToGemini(
  finishReason: string | null,
): GeminiCandidate["finishReason"] {
  switch (finishReason) {
    case "stop": {
      return "STOP"
    }
    case "length": {
      return "MAX_TOKENS"
    }
    case "content_filter": {
      return "SAFETY"
    }
    case "tool_calls": {
      return "STOP" // Gemini doesn't have a specific tool_calls finish reason, map to STOP
    }
    default: {
      return "FINISH_REASON_UNSPECIFIED"
    }
  }
}

// Add the reverse mapping - Gemini → OpenAI (based on LiteLLM research)
export function mapGeminiFinishReasonToOpenAI(
  finishReason: string | undefined,
): "stop" | "length" | "content_filter" | "tool_calls" {
  switch (finishReason) {
    case "STOP":
    case "FINISH_REASON_UNSPECIFIED":
    case "MALFORMED_FUNCTION_CALL": {
      return "stop"
    }
    case "MAX_TOKENS": {
      return "length"
    }
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY": {
      return "content_filter"
    }
    default: {
      return "stop"
    }
  }
}
