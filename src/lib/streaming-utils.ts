import { events } from "fetch-event-stream"

/**
 * Create streaming response - simple pass-through for all models
 * No format conversion needed since all requests are OpenAI format
 */
export async function* createStreamingResponse(
  response: Response,
): AsyncIterable<any> {
  const eventStream = events(response)

  for await (const event of eventStream) {
    yield event
  }
}
