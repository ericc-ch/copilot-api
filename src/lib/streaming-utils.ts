import { events } from "fetch-event-stream"
import { openAIToAnthropic } from "./format-converter"

/**
 * Create streaming response for all models
 * Simple pass-through implementation
 */
export async function* createStreamingResponse(
  response: Response,
): AsyncIterable<any> {
  // Handle all models (including Anthropic models)

  const eventStream = events(response)

  for await (const event of eventStream) {
    yield event
  }
}

/**
 * Create streaming response with format conversion
 */
export async function* createStreamingResponseWithFormat(
  response: Response,
  originalFormat: string,
): AsyncIterable<any> {
  const eventStream = events(response)

  for await (const event of eventStream) {
    // Convert streaming chunks if needed
    if (event.data && event.data !== '[DONE]') {
      try {
        const chunk = JSON.parse(event.data)
        const convertedChunk = openAIToAnthropic(chunk, originalFormat)
        yield {
          ...event,
          data: JSON.stringify(convertedChunk)
        }
      } catch {
        // If parsing fails, pass through as-is
        yield event
      }
    } else {
      yield event
    }
  }
}
