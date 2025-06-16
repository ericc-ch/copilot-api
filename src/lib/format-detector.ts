/**
 * Simple format detection for Anthropic vs OpenAI requests
 * Only used to detect incoming format - no response conversion
 */

export interface FormatDetectionResult {
  isAnthropic: boolean
  originalFormat: 'anthropic' | 'openai'
}

/**
 * Detect if request is in Anthropic format
 * Based on Anthropic-specific fields and structures
 */
export function detectFormat(payload: any): FormatDetectionResult {
  const isAnthropic = !!(
    // Anthropic system format (array instead of string)
    (Array.isArray(payload.system)) ||
    
    // Anthropic metadata field
    (payload.metadata) ||
    
    // Anthropic message content structures
    (payload.messages?.some((msg: any) =>
      msg.content?.some?.((part: any) =>
        part.cache_control ||
        part.type === 'tool_use' ||
        part.type === 'tool_result'
      )
    )) ||
    
    // Anthropic tool format (input_schema instead of function)
    (payload.tools?.some((tool: any) => tool.input_schema && !tool.function)) ||
    
    // Anthropic tool_choice format (object with type)
    (typeof payload.tool_choice === 'object' && payload.tool_choice?.type)
  )

  return {
    isAnthropic,
    originalFormat: isAnthropic ? 'anthropic' : 'openai'
  }
}
