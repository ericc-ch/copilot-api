import { Hono } from "hono"

import { forwardError } from "~/lib/error"

import {
  handleGeminiGeneration,
  handleGeminiStreamGeneration,
  handleGeminiCountTokens,
} from "./handler"

function isStreamGenerate(url: string): boolean {
  return url.includes(":streamGenerateContent")
}
function isCountTokens(url: string): boolean {
  return url.includes(":countTokens")
}
function isGenerate(url: string): boolean {
  return (
    url.includes(":generateContent") && !url.includes(":streamGenerateContent")
  )
}

const router = new Hono()

// Streaming generation endpoint
// POST /v1beta/models/{model}:streamGenerateContent
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (isStreamGenerate(url)) {
    try {
      return await handleGeminiStreamGeneration(c)
    } catch (error) {
      return await forwardError(c, error)
    }
  }
  await next()
})

// Token counting endpoint
// POST /v1beta/models/{model}:countTokens
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (isCountTokens(url)) {
    try {
      return await handleGeminiCountTokens(c)
    } catch (error) {
      return await forwardError(c, error)
    }
  }
  await next()
})

// Standard generation endpoint
// POST /v1beta/models/{model}:generateContent
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (isGenerate(url)) {
    try {
      return await handleGeminiGeneration(c)
    } catch (error) {
      return await forwardError(c, error)
    }
  }
  await next()
})

export { router as geminiRouter }
