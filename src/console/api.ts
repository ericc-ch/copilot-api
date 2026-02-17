import { Hono } from "hono"
import { cors } from "hono/cors"
import { z } from "zod"

import {
  addAccount,
  deleteAccount,
  getAccount,
  getAccounts,
  getPoolConfig,
  regenerateApiKey,
  regeneratePoolApiKey,
  updateAccount,
  updatePoolConfig,
} from "./account-store"
import {
  isSetupRequired,
  loginAdmin,
  setupAdmin,
  validateSession,
} from "./admin-auth"
import { cleanupSession, getSession, startDeviceFlow } from "./auth-flow"
import {
  getInstanceError,
  getInstanceStatus,
  getInstanceUsage,
  getInstanceUser,
  startInstance,
  stopInstance,
} from "./instance-manager"

let proxyPort = 4141

export function setProxyPort(port: number): void {
  proxyPort = port
}

function formatZodError(err: z.ZodError): string {
  return z.treeifyError(err).children ?
      JSON.stringify(z.treeifyError(err))
    : err.message
}

export const consoleApi = new Hono()

consoleApi.use(cors())

// Public endpoints (no auth required)
consoleApi.get("/config", async (c) => {
  const needsSetup = await isSetupRequired()
  return c.json({ proxyPort, needsSetup })
})

const SetupSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
})

consoleApi.post("/auth/setup", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = SetupSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }
  try {
    const token = await setupAdmin(parsed.data.username, parsed.data.password)
    return c.json({ token })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

consoleApi.post("/auth/login", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }
  const token = await loginAdmin(parsed.data.username, parsed.data.password)
  if (!token) {
    return c.json({ error: "Invalid username or password" }, 401)
  }
  return c.json({ token })
})

// Admin auth middleware (session token)
consoleApi.use("/*", async (c, next) => {
  const auth = c.req.header("authorization")
  const token = auth?.replace("Bearer ", "")
  if (!token || !(await validateSession(token))) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  return next()
})

// Auth check endpoint
consoleApi.get("/auth/check", (c) => c.json({ ok: true }))

// List all accounts with status
consoleApi.get("/accounts", async (c) => {
  const accounts = await getAccounts()
  const result = await Promise.all(
    accounts.map(async (account) => {
      const status = getInstanceStatus(account.id)
      const error = getInstanceError(account.id)
      let user: { login: string } | null = null
      if (status === "running") {
        try {
          user = await getInstanceUser(account.id)
        } catch {
          /* ignore */
        }
      }
      return { ...account, status, error, user }
    }),
  )
  return c.json(result)
})

// Batch usage for all running accounts
consoleApi.get("/accounts/usage", async (c) => {
  const accounts = await getAccounts()
  const results = await Promise.all(
    accounts.map(async (account) => {
      const status = getInstanceStatus(account.id)
      if (status !== "running") {
        return {
          accountId: account.id,
          name: account.name,
          status,
          usage: null,
        }
      }
      try {
        const usage = await getInstanceUsage(account.id)
        return { accountId: account.id, name: account.name, status, usage }
      } catch {
        return {
          accountId: account.id,
          name: account.name,
          status,
          usage: null,
        }
      }
    }),
  )
  return c.json(results)
})

// Get single account
consoleApi.get("/accounts/:id", async (c) => {
  const account = await getAccount(c.req.param("id"))
  if (!account) return c.json({ error: "Account not found" }, 404)
  const status = getInstanceStatus(account.id)
  const error = getInstanceError(account.id)
  return c.json({ ...account, status, error })
})

const AddAccountSchema = z.object({
  name: z.string().min(1),
  githubToken: z.string().min(1),
  accountType: z.string().default("individual"),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
})

// Add account
consoleApi.post("/accounts", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = AddAccountSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }
  const account = await addAccount(parsed.data)
  return c.json(account, 201)
})

const UpdateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  githubToken: z.string().min(1).optional(),
  accountType: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
})

// Update account
consoleApi.put("/accounts/:id", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = UpdateAccountSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }
  const account = await updateAccount(c.req.param("id"), parsed.data)
  if (!account) return c.json({ error: "Account not found" }, 404)
  return c.json(account)
})

// Delete account
consoleApi.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id")
  stopInstance(id)
  const deleted = await deleteAccount(id)
  if (!deleted) return c.json({ error: "Account not found" }, 404)
  return c.json({ ok: true })
})

// Regenerate API key
consoleApi.post("/accounts/:id/regenerate-key", async (c) => {
  const account = await regenerateApiKey(c.req.param("id"))
  if (!account) return c.json({ error: "Account not found" }, 404)
  return c.json(account)
})

// Start instance
consoleApi.post("/accounts/:id/start", async (c) => {
  const account = await getAccount(c.req.param("id"))
  if (!account) return c.json({ error: "Account not found" }, 404)
  try {
    await startInstance(account)
    return c.json({ status: "running" })
  } catch (error) {
    return c.json({ error: (error as Error).message, status: "error" }, 500)
  }
})

// Stop instance
consoleApi.post("/accounts/:id/stop", (c) => {
  stopInstance(c.req.param("id"))
  return c.json({ status: "stopped" })
})

// Get usage for account
consoleApi.get("/accounts/:id/usage", async (c) => {
  const usage = await getInstanceUsage(c.req.param("id"))
  if (!usage)
    return c.json({ error: "Instance not running or usage unavailable" }, 404)
  return c.json(usage)
})

// === Device Code Auth Flow ===

consoleApi.post("/auth/device-code", async (c) => {
  try {
    const result = await startDeviceFlow()
    return c.json(result)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

consoleApi.get("/auth/poll/:sessionId", (c) => {
  const session = getSession(c.req.param("sessionId"))
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json({
    status: session.status,
    accessToken:
      session.status === "completed" ? session.accessToken : undefined,
    error: session.error,
  })
})

const CompleteAuthSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  accountType: z.string().default("individual"),
})

consoleApi.post("/auth/complete", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = CompleteAuthSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }

  const session = getSession(parsed.data.sessionId)
  if (!session) return c.json({ error: "Session not found" }, 404)
  if (session.status !== "completed" || !session.accessToken) {
    return c.json({ error: "Auth not completed yet" }, 400)
  }

  const account = await addAccount({
    name: parsed.data.name,
    githubToken: session.accessToken,
    accountType: parsed.data.accountType,
    enabled: true,
  })

  cleanupSession(parsed.data.sessionId)
  return c.json(account, 201)
})

// === Pool Configuration ===

consoleApi.get("/pool", async (c) => {
  const config = await getPoolConfig()
  return c.json(config ?? { enabled: false, strategy: "round-robin" })
})

const UpdatePoolSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: z.enum(["round-robin", "priority"]).optional(),
})

consoleApi.put("/pool", async (c) => {
  const body: unknown = await c.req.json()
  const parsed = UpdatePoolSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: formatZodError(parsed.error) }, 400)
  }
  const config = await updatePoolConfig(parsed.data)
  return c.json(config)
})

consoleApi.post("/pool/regenerate-key", async (c) => {
  const config = await regeneratePoolApiKey()
  return c.json(config)
})
