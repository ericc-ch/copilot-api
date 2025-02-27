interface ContentFilterResults {
  error: {
    code: string
    message: string
  }
  hate: {
    filtered: boolean
    severity: string
  }
  self_harm: {
    filtered: boolean
    severity: string
  }
  sexual: {
    filtered: boolean
    severity: string
  }
  violence: {
    filtered: boolean
    severity: string
  }
}

interface ContentFilterOffsets {
  check_offset: number
  start_offset: number
  end_offset: number
}

interface Delta {
  content?: string
  role?: string
}

interface Choice {
  index: number
  content_filter_offsets?: ContentFilterOffsets
  content_filter_results?: ContentFilterResults
  delta: Delta
  finish_reason?: string | null
}

interface PromptFilterResult {
  content_filter_results: ContentFilterResults
  prompt_index: number
}

interface Usage {
  completion_tokens: number
  prompt_tokens: number
  total_tokens: number
}

export interface ChatCompletionChunk {
  choices: [Choice]
  created: number
  object: "chat.completion.chunk"
  id: string
  model: string
  system_fingerprint?: string
  prompt_filter_results?: Array<PromptFilterResult>
  usage?: Usage | null
}
