import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { serveStatic } from "hono/bun"

import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { usageRoute } from "./routes/usage/route"
import { tokenRoute } from "./routes/token/route"

export const server = new Hono()

server.use(logger())
server.use(cors())

server.get("/", (c) => c.text("Server running"))

// Serve static files from public directory
server.use("/public/*", serveStatic({ root: "./src" }))

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)
server.route("/v1/usage", usageRoute)
server.route("/v1/token", tokenRoute)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)
server.post("/v1/messages/count_tokens", (c) => c.json({ input_tokens: 1 }))
