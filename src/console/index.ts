import { defineCommand } from "citty"
import consola from "consola"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import fs from "node:fs/promises"
import path from "node:path"
import { serve, type ServerHandler } from "srvx"

import { ensurePaths } from "~/lib/paths"

import { getAccountByApiKey, getAccounts, getPoolConfig } from "./account-store"
import { consoleApi, setProxyPort } from "./api"
import {
  completionsHandler,
  countTokensHandler,
  embeddingsHandler,
  getInstanceState,
  messagesHandler,
  modelsHandler,
  startInstance,
} from "./instance-manager"
import { selectAccount } from "./load-balancer"

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

export const console_ = defineCommand({
  meta: {
    name: "console",
    description: "Start the multi-account management console",
  },
  args: {
    "web-port": {
      alias: "w",
      type: "string",
      default: "3000",
      description: "Port for the web management console",
    },
    "proxy-port": {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port for the proxy API endpoints",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "auto-start": {
      type: "boolean",
      default: true,
      description: "Auto-start enabled accounts on launch",
    },
  },

  async run({ args }) {
    if (args.verbose) {
      consola.level = 5
    }

    await ensurePaths()

    const webPort = Number.parseInt(args["web-port"], 10)
    const proxyPort = Number.parseInt(args["proxy-port"], 10)
    setProxyPort(proxyPort)

    // === Web console server ===
    const webApp = new Hono()
    webApp.use(cors())
    webApp.use(logger())
    webApp.route("/api", consoleApi)
    await mountStaticFiles(webApp)

    // === Proxy server ===
    const proxyApp = new Hono()
    proxyApp.use(cors())
    mountProxyRoutes(proxyApp)

    // Auto-start enabled accounts
    if (args["auto-start"]) {
      await autoStartAccounts()
    }

    serve({ fetch: webApp.fetch as ServerHandler, port: webPort })
    serve({ fetch: proxyApp.fetch as ServerHandler, port: proxyPort })

    consola.box(
      [
        `🎛️  Console:  http://localhost:${webPort}`,
        `🔐 First visit to set up admin account`,
        "",
        `Proxy (port ${proxyPort}) — use account API key as Bearer token:`,
        `   OpenAI:    http://localhost:${proxyPort}/v1/chat/completions`,
        `   Anthropic: http://localhost:${proxyPort}/v1/messages`,
        `   Models:    http://localhost:${proxyPort}/v1/models`,
      ].join("\n"),
    )
  },
})

function mountProxyRoutes(app: Hono): void {
  app.post("/chat/completions", proxyAuth, (c) =>
    withPoolRetry(c, completionsHandler),
  )
  app.post("/v1/chat/completions", proxyAuth, (c) =>
    withPoolRetry(c, completionsHandler),
  )
  app.get("/models", proxyAuth, (c) => modelsHandler(c, getState(c)))
  app.get("/v1/models", proxyAuth, (c) => modelsHandler(c, getState(c)))
  app.post("/embeddings", proxyAuth, (c) => withPoolRetry(c, embeddingsHandler))
  app.post("/v1/embeddings", proxyAuth, (c) =>
    withPoolRetry(c, embeddingsHandler),
  )
  app.post("/v1/messages", proxyAuth, (c) => withPoolRetry(c, messagesHandler))
  app.post("/v1/messages/count_tokens", proxyAuth, (c) =>
    withPoolRetry(c, countTokensHandler),
  )
}

async function mountStaticFiles(app: Hono): Promise<void> {
  const webDistPath = path.resolve(import.meta.dirname, "../../web/dist")

  let hasWebDist = false
  try {
    await fs.access(webDistPath)
    hasWebDist = true
  } catch {
    /* no built frontend */
  }

  if (hasWebDist) {
    app.get("/*", async (c) => {
      const reqPath = c.req.path === "/" ? "/index.html" : c.req.path
      const filePath = path.join(webDistPath, reqPath)
      try {
        const content = await fs.readFile(filePath)
        const ext = path.extname(filePath)
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
        const cacheControl =
          reqPath.startsWith("/assets/") ?
            "public, max-age=31536000, immutable"
          : "no-cache"
        return c.body(content.buffer as ArrayBuffer, {
          headers: {
            "content-type": contentType,
            "cache-control": cacheControl,
          },
        })
      } catch {
        const indexContent = await fs.readFile(
          path.join(webDistPath, "index.html"),
          "utf8",
        )
        return c.html(indexContent)
      }
    })
  } else {
    app.get("/", (c) =>
      c.text(
        "Console API running. Build the web UI with: cd web && bun install && bun run build",
      ),
    )
  }
}

async function autoStartAccounts(): Promise<void> {
  const accounts = await getAccounts()
  for (const account of accounts) {
    if (account.enabled) {
      try {
        await startInstance(account)
      } catch (error) {
        consola.error(`Failed to auto-start account "${account.name}":`, error)
      }
    }
  }
}

async function proxyAuth(
  c: import("hono").Context,
  next: () => Promise<void>,
): Promise<Response | undefined> {
  const auth = c.req.header("authorization")
  const token = auth?.replace(/^Bearer\s+/i, "")

  // Try per-account key first
  if (token) {
    const account = await getAccountByApiKey(token)
    if (account) {
      const st = getInstanceState(account.id)
      if (!st) {
        return c.json({ error: "Account instance not running" }, 503)
      }
      c.set("proxyState", st)
      await next()
      return
    }
  }

  // Fall back to pool mode
  const poolConfig = await getPoolConfig()
  if (!poolConfig?.enabled || !token || token !== poolConfig.apiKey) {
    return c.json({ error: "Invalid API key" }, 401)
  }

  const result = await selectAccount(poolConfig.strategy)
  if (!result) {
    return c.json({ error: "No available accounts in pool" }, 503)
  }

  c.set("proxyState", result.state)
  c.set("poolMode", true)
  c.set("poolStrategy", poolConfig.strategy)
  c.set("poolAccountId", result.account.id)
  await next()
}

function getState(c: import("hono").Context): import("~/lib/state").State {
  return c.get("proxyState") as import("~/lib/state").State
}

type Handler = (
  c: import("hono").Context,
  st: import("~/lib/state").State,
) => Promise<Response> | Response

async function withPoolRetry(
  c: import("hono").Context,
  handler: Handler,
): Promise<Response> {
  const isPool = c.get("poolMode") as boolean | undefined
  if (!isPool) {
    return handler(c, getState(c))
  }

  // Buffer the body for potential retries
  const body: unknown = await c.req.json()
  c.set("bufferedBody", body)

  const strategy = c.get("poolStrategy") as "round-robin" | "priority"
  const exclude = new Set<string>()

  // First attempt with the account already selected by proxyAuth
  const firstResponse = await handler(c, getState(c))
  if (!isRetryableStatus(firstResponse.status)) {
    return firstResponse
  }

  // Add the first account to exclude list and retry with others
  exclude.add(c.get("poolAccountId") as string)

  while (true) {
    const next = await selectAccount(strategy, exclude)
    if (!next) {
      // No more accounts to try, return the last error response
      return firstResponse
    }

    exclude.add(next.account.id)
    c.set("proxyState", next.state)

    const retryResponse = await handler(c, next.state)
    if (!isRetryableStatus(retryResponse.status)) {
      return retryResponse
    }
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}
