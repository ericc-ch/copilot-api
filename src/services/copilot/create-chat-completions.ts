import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/http-error"
import { transformModelName } from "~/lib/models"
import { state } from "~/lib/state"
import { createStreamingResponse } from "~/lib/streaming-utils"

export const createChatCompletions = async (
  payload: any,
): Promise<any | AsyncIterable<any>> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Transform model name
  if (payload.model) {
    payload.model = transformModelName(payload.model)
  }

  // Process all models (including Anthropic models)
  const processedPayload = { ...payload }



  try {
    // Detect vision usage for headers
    const visionEnable = processedPayload.messages?.some(
      (message: any) =>
        Array.isArray(message.content)
        && message.content.some(
          (part: any) => part.type === "image_url" || part.type === "image",
        ),
    )

    const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
      method: "POST",
      headers: copilotHeaders(state, visionEnable),
      body: JSON.stringify(processedPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()



      throw new HTTPError(
        `Failed to create chat completions: ${errorText}`,
        response,
      )
    }

    if (processedPayload.stream) {
      return createStreamingResponse(response)
    }

    const responseData = (await response.json()) as any
    return responseData
  } catch (error) {
    throw error
  }
}

// Flexible types for maximum compatibility
export type MessageRole = "user" | "assistant" | "system" | "tool"

export interface ChatCompletionsPayload {
  messages: Array<any>
  model: string
  [key: string]: any // Allow any additional fields
}
