// Ollama API Types
export interface OllamaChatPayload {
  model: string
  messages: Array<{
    role: string
    content: string
    images?: Array<string>
  }>
  stream?: boolean
  format?: {
    type: string
    properties: Record<string, unknown>
    required?: Array<string>
  }
  options?: {
    temperature?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    stop?: Array<string>
    seed?: number
  }
  max_tokens?: number
  /**
   * OpenAI-compatible tools parameter for function calling.
   * See: https://platform.openai.com/docs/guides/function-calling
   */
  tools?: Array<Record<string, unknown>>
}

export interface OllamaChatResponse {
  model: string
  created_at: string
  message: {
    role: string
    content: string
    images?: Array<string>
    tool_calls?: Array<{
      function: {
        name: string
        arguments: Record<string, unknown>
      }
    }>
  }
  done_reason?: string
  done: boolean
  total_duration: number
  load_duration: number
  prompt_eval_count: number
  prompt_eval_duration: number
  eval_count: number
  eval_duration: number
}

export interface OllamaChatStreamChunk {
  model: string
  created_at: string
  message: {
    role: string
    content: string
    images?: null
  }
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

// Interface for Ollama List Models API response
export interface OllamaListModelsResponse {
  models: Array<{
    name: string
    modified_at: string
    size: number
    digest: string
    details: {
      format: string
      family: string
      families: null | Array<string>
      parameter_size: string
      quantization_level: string
    }
  }>
}

// OpenAI Types
export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
    }
    finish_reason: string | null
  }>
}

// OpenAI Streaming Types
export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
    }
    finish_reason: string | null
  }>
  data?: string // For SSE stream chunks
}
