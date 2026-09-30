import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { forwardError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  chatResultToCompletionResult,
  completionPayloadToChatPayload,
  streamChatAsCompletionChunks,
} from "~/services/copilot/completions-adapter"
import { createChatCompletions } from "~/services/copilot/create-chat-completions"
import {
  aggregateProxyCompletionsStream,
  createProxyCompletions,
  type CompletionsPayload,
} from "~/services/copilot/create-proxy-completions"

export const completionsRoutes = new Hono()

completionsRoutes.post("/", async (c) => {
  try {
    // same request guards as the chat route: rate limit + manual approval
    await checkRateLimit(state)
    if (state.manualApprove) await awaitApproval()

    const body = (await c.req.json()) as unknown
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "model is required" }, 400)
    }
    const payload = body as CompletionsPayload
    if (typeof payload.model !== "string" || payload.model.length === 0) {
      return c.json({ error: "model is required" }, 400)
    }

    // legacy fill-in-the-middle engines (gpt-41-copilot, ...) live behind
    // the traditional proxy completions API; everything else is translated
    // through Chat Completions so all models are reachable here
    if (payload.model.endsWith("-copilot")) {
      if (payload.stream) {
        const response = await createProxyCompletions(payload)
        const body = response.body
        if (!body) {
          return c.json({ error: "Empty response body" }, 502)
        }
        return c.body(body, 200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        })
      }

      const result = await aggregateProxyCompletionsStream(payload)
      return c.json(result)
    }

    // array prompts are independent prompts (or FIM prefix/suffix pairs) in
    // the legacy contract and cannot be translated to a single chat turn
    if (Array.isArray(payload.prompt)) {
      return c.json(
        {
          error:
            "Array prompts are only supported for -copilot engine models; chat-model translation accepts a single string prompt",
        },
        400,
      )
    }

    // FIM suffix has no chat-completions equivalent; reject explicitly
    // instead of silently dropping it
    if (payload.suffix !== undefined && payload.suffix !== null) {
      return c.json(
        { error: "suffix is only supported for -copilot engine models" },
        400,
      )
    }

    const chatPayload = completionPayloadToChatPayload(payload)

    if (payload.stream) {
      const chatStream = (await createChatCompletions({
        ...chatPayload,
        stream: true,
      })) as AsyncIterable<{ data?: string | null }>

      return streamSSE(c, async (stream) => {
        for await (const event of streamChatAsCompletionChunks(chatStream)) {
          await stream.writeSSE({ data: event.data })
        }
      })
    }

    const chatResult = await createChatCompletions(chatPayload)
    const result = chatResultToCompletionResult(
      chatResult as Parameters<typeof chatResultToCompletionResult>[0],
    )
    return c.json(result)
  } catch (error) {
    return await forwardError(c, error)
  }
})
