# Gemini API Support Implementation Plan

## Current Architecture
This repository accepts incoming calls in **OpenAI** and **Anthropic** styles, forwards them to the **GitHub Copilot backend API**, then converts responses back to the caller's expected format.

## Objective
Add **Gemini API** support to enable forwarding Gemini CLI calls to Copilot backend and returning properly formatted responses.

## Implementation Approach
Follow the existing pattern used for OpenAI and Anthropic API translations:
1. Parse incoming Gemini API requests
2. Translate to GitHub Copilot format
3. Process Copilot response
4. Convert to Gemini API response format

## Gemini API Structure Analysis

### Authentication
- Header: `x-goog-api-key: {API_KEY}`
- API key obtainable from Google AI Studio (we do not actually need this, since we just call github)

### Key Endpoints to Support

#### 1. Content Generation
- **Standard**: `POST /v1beta/{model=models/*}:generateContent`
- **Streaming**: `POST /v1beta/{model=models/*}:streamGenerateContent`

#### 2. Token Counting
- **Endpoint**: `POST /v1beta/{model=models/*}:countTokens`

### Request Structure
```typescript
interface GeminiRequest {
  contents: Content[];           // Required: conversation history
  tools?: Tool[];               // Optional: function calling
  toolConfig?: ToolConfig;      // Optional: tool configuration
  safetySettings?: SafetySetting[]; // Optional: content filtering
  systemInstruction?: Content;  // Optional: system prompt
  generationConfig?: GenerationConfig; // Optional: generation parameters
}

interface Content {
  parts: Part[];
  role?: string; // "user" | "model"
}
```

### Response Structure
- **Standard**: Single complete response
- **Streaming**: Server-Sent Events format
- **Token Count**: `{ totalTokens: number }`

## Development & Testing Workflow

### Port Configuration
- **Development Port**: `4142` (for new Gemini implementation)
- **Production Port**: `4141` (existing OpenAI/Anthropic APIs - DO NOT TOUCH)

### Logging Strategy
All Gemini API interactions will be logged to dedicated files for debugging:

```typescript
// Log structure for debugging
interface GeminiDebugLog {
  timestamp: string;
  type: 'request' | 'response' | 'translation' | 'error';
  endpoint: string;
  data: any;
  copilotRequest?: any;  // Translated request to Copilot
  copilotResponse?: any; // Response from Copilot
  finalResponse?: any;   // Final response to client
}
```

### Log Files
- **Main Log**: `logs/gemini-debug.log` - All Gemini API interactions
- **Error Log**: `logs/gemini-errors.log` - Errors and exceptions
- **Translation Log**: `logs/gemini-translation.log` - Request/response translations

### Debug Workflow
1. **User** runs modified code on port `4142`
3. **User** uses Gemini CLI to send test prompts
2. **Claude** reads log files to understand issues
4. **Claude** analyzes logs and fixes issues
5. Repeat until working correctly

### Test Commands
```bash
# Start development server
bun run dev start --port 4142 --verbose (you as claude, should not run it, i run it)

## Reference Documentation
- [Gemini API Overview](https://ai.google.dev/api)
- [Stream Generate Content](https://ai.google.dev/api/generate-content#method:-models.streamGenerateContent)
- [Token Counting API](https://ai.google.dev/api/tokens)
- [Vertex AI Token Counting](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/count-tokens)