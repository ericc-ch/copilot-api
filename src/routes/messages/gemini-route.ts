import { Hono } from "hono"

import {
  handleGeminiGeneration,
  handleGeminiStreamGeneration,
  handleGeminiCountTokens,
} from "./gemini-handler"

const router = new Hono()

// IMPORTANT: Most specific routes FIRST to avoid pattern conflicts
// Use wildcard patterns to handle colons properly

// Streaming generation endpoint - MOST specific (to avoid conflicts)
// POST /v1beta/{model=models/*}:streamGenerateContent
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (url.includes(":streamGenerateContent")) {
    return handleGeminiStreamGeneration(c)
  }
  await next()
})

// Token counting endpoint - Second most specific
// POST /v1beta/{model=models/*}:countTokens
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (url.includes(":countTokens")) {
    return handleGeminiCountTokens(c)
  }
  await next()
})

// Standard generation endpoint - Least specific
// POST /v1beta/{model=models/*}:generateContent
router.post("/v1beta/models/*", async (c, next) => {
  const url = c.req.url
  if (
    url.includes(":generateContent")
    && !url.includes(":streamGenerateContent")
  ) {
    return handleGeminiGeneration(c)
  }
  await next()
})

export { router as geminiRouter }
