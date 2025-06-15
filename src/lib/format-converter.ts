/**
 * Lightweight format converter for Anthropic ↔ OpenAI compatibility
 */

export interface FormatDetectionResult {
  isAnthropic: boolean
  originalFormat: 'anthropic' | 'openai'
}

/**
 * Detect if request is in Anthropic format
 */
export function detectFormat(payload: any): FormatDetectionResult {
  const isAnthropic = !!(
    (Array.isArray(payload.system)) ||
    (payload.metadata) ||
    (payload.messages?.some((msg: any) =>
      msg.content?.some?.((part: any) =>
        part.cache_control ||
        part.type === 'tool_use' ||
        part.type === 'tool_result'
      )
    )) ||
    (payload.tools?.some((tool: any) => tool.input_schema && !tool.function)) ||
    (typeof payload.tool_choice === 'object' && payload.tool_choice?.type)
  )

  return {
    isAnthropic,
    originalFormat: isAnthropic ? 'anthropic' : 'openai'
  }
}

/**
 * Convert Anthropic format to OpenAI format
 */
export function anthropicToOpenAI(payload: any): any {
  const converted = { ...payload }

  // Convert system array to string
  if (Array.isArray(converted.system)) {
    converted.system = converted.system
      .map((s: any) => typeof s === 'string' ? s : s.text || '')
      .join('\n')
  }

  // Remove Anthropic-specific fields
  delete converted.metadata

  // Convert messages from Anthropic to OpenAI format
  if (converted.messages) {
    const convertedMessages: any[] = []

    converted.messages.forEach((msg: any) => {
      if (Array.isArray(msg.content)) {
        // Separate tool_use and tool_result content from other content
        const toolUseContent = msg.content.filter((part: any) => part.type === 'tool_use')
        const toolResultContent = msg.content.filter((part: any) => part.type === 'tool_result')
        const otherContent = msg.content.filter((part: any) =>
          part.type !== 'tool_use' && part.type !== 'tool_result'
        )

        // Clean cache_control from non-tool content
        const cleanedContent = otherContent.map((part: any) => {
          const { cache_control, ...cleanPart } = part
          return cleanPart
        })

        // Handle tool_result content - convert to separate tool messages
        if (toolResultContent.length > 0) {
          // Add tool result messages separately
          toolResultContent.forEach((toolResult: any) => {
            const toolContent = Array.isArray(toolResult.content)
              ? toolResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
              : typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content)

            convertedMessages.push({
              role: "tool",
              name: "tool_result", // or extract from tool_use_id if needed
              tool_call_id: toolResult.tool_use_id,
              content: toolContent
            })
          })

          // If this message only contains tool_result content, don't add the original message
          if (otherContent.length === 0) {
            return
          }
        }

        // Combine remaining content (excluding tool results)
        const allContent = [...cleanedContent]

        // Convert tool_use to GitHub Copilot API tool_calls format
        if (toolUseContent.length > 0) {
          const tool_calls = toolUseContent.map((toolUse: any, index: number) => ({
            type: "function",
            id: toolUse.id || `call_${Math.random().toString(36).substring(2, 15)}`,
            index: index,
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input || {})
            }
          }))

          // For assistant messages with tool calls, content should be empty string
          // and tool_calls should be at message level (GitHub Copilot format)
          if (msg.role === 'assistant') {
            convertedMessages.push({
              ...msg,
              content: allContent.length > 0 ? allContent : "",
              tool_calls
            })
            return
          }
        }

        // Add regular message
        convertedMessages.push({
          ...msg,
          content: allContent.length > 0 ? allContent : msg.content
        })
      } else {
        // Non-array content, add as-is
        convertedMessages.push(msg)
      }
    })

    converted.messages = convertedMessages
  }

  // Convert tools from Anthropic to OpenAI format
  if (converted.tools) {
    converted.tools = converted.tools.map((tool: any) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }))
  }

  // Convert tool_choice from Anthropic to OpenAI format
  if (converted.tool_choice) {
    if (typeof converted.tool_choice === 'object' && converted.tool_choice.type === 'auto') {
      converted.tool_choice = 'auto'
    } else if (typeof converted.tool_choice === 'object' && converted.tool_choice.type === 'tool') {
      converted.tool_choice = {
        type: 'function',
        function: { name: converted.tool_choice.name }
      }
    }
  }

  return converted
}

/**
 * Convert OpenAI response back to Anthropic format if needed
 */
export function openAIToAnthropic(response: any, originalFormat: string): any {
  if (originalFormat !== 'anthropic') {
    return response
  }

  // Handle streaming chunks
  if (response.choices && response.choices[0]?.delta) {
    const choice = response.choices[0]
    const delta = choice.delta

    // Convert tool_calls in streaming delta to Anthropic format
    if (delta.tool_calls) {
      const convertedContent = delta.tool_calls.map((toolCall: any) => ({
        type: "tool_use",
        id: toolCall.id || `toolu_${Math.random().toString(36).substring(2, 11)}`,
        name: toolCall.function?.name,
        input: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}
      }))

      return {
        ...response,
        content: convertedContent,
        stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason
      }
    }

    // Convert regular content
    if (delta.content) {
      return {
        ...response,
        content: [{ type: "text", text: delta.content }]
      }
    }

    return response
  }

  // Handle non-streaming response
  if (response.choices && response.choices[0]?.message) {
    const message = response.choices[0].message
    const content = []

    // Add text content
    if (message.content) {
      content.push({
        type: "text",
        text: message.content
      })
    }

    // Convert tool_calls to Anthropic format
    if (message.tool_calls) {
      message.tool_calls.forEach((toolCall: any) => {
        content.push({
          type: "tool_use",
          id: toolCall.id || `toolu_${Math.random().toString(36).substring(2, 11)}`,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}')
        })
      })
    }

    return {
      id: response.id,
      type: "message",
      role: "assistant",
      content,
      model: response.model,
      stop_reason: response.choices[0].finish_reason === 'tool_calls' ? 'tool_use' : response.choices[0].finish_reason,
      usage: response.usage
    }
  }

  // Fallback: return as-is
  return response
}
