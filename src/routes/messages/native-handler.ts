import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  createNativeMessages,
  type NativeMessagesPayload,
} from "~/services/copilot/create-native-messages"

const FORWARDED_REQUEST_HEADERS = ["anthropic-version", "anthropic-beta"]
// retry-after and x-should-retry are the retry signals that Anthropic SDKs read.
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "retry-after",
  "x-should-retry",
]

// Copilot's /v1/messages rejects a trailing assistant message (prefill) for
// current Claude models, so these requests keep the translation path.
export function shouldUseNativeMessages(
  payload: NativeMessagesPayload,
): boolean {
  return (
    state.nativeMessages
    && payload.model.startsWith("claude")
    && payload.messages.at(-1)?.role !== "assistant"
  )
}

function pickHeaders(
  headers: Headers,
  names: Array<string>,
): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const name of names) {
    const value = headers.get(name)
    if (value) picked[name] = value
  }
  return picked
}

function toClientResponse(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: pickHeaders(upstream.headers, FORWARDED_RESPONSE_HEADERS),
  })
}

export async function handleNativeCompletion(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  try {
    const upstream = await createNativeMessages(
      payload,
      pickHeaders(clientHeaders, FORWARDED_REQUEST_HEADERS),
    )
    return toClientResponse(upstream)
  } catch (error) {
    // Upstream errors keep their status, body and retry-after so that the
    // client can decide whether to retry.
    if (error instanceof HTTPError) return toClientResponse(error.response)
    throw error
  }
}
