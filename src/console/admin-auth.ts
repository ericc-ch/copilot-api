import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

interface AdminCredentials {
  username: string
  passwordHash: string
}

interface AdminStore {
  credentials: AdminCredentials | null
  sessions: Array<{ token: string; createdAt: string }>
}

const STORE_PATH = path.join(PATHS.APP_DIR, "admin.json")
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

async function readStore(): Promise<AdminStore> {
  try {
    const data = await fs.readFile(STORE_PATH)
    return JSON.parse(data) as AdminStore
  } catch {
    return { credentials: null, sessions: [] }
  }
}

async function writeStore(store: AdminStore): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2))
}

export async function isSetupRequired(): Promise<boolean> {
  const store = await readStore()
  return store.credentials === null
}

export async function setupAdmin(
  username: string,
  password: string,
): Promise<string> {
  const store = await readStore()
  if (store.credentials !== null) {
    throw new Error("Admin already configured")
  }
  const passwordHash = await Bun.password.hash(password)
  const token = generateSessionToken()
  store.credentials = { username, passwordHash }
  store.sessions = [{ token, createdAt: new Date().toISOString() }]
  await writeStore(store)
  return token
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<string | null> {
  const store = await readStore()
  if (!store.credentials) return null
  if (store.credentials.username !== username) return null
  const valid = await Bun.password.verify(
    password,
    store.credentials.passwordHash,
  )
  if (!valid) return null
  const token = generateSessionToken()
  cleanExpiredSessions(store)
  store.sessions.push({ token, createdAt: new Date().toISOString() })
  await writeStore(store)
  return token
}

export async function validateSession(token: string): Promise<boolean> {
  const store = await readStore()
  const now = Date.now()
  return store.sessions.some((s) => {
    const age = now - new Date(s.createdAt).getTime()
    return s.token === token && age < SESSION_TTL_MS
  })
}

function generateSessionToken(): string {
  return `session-${crypto.randomBytes(24).toString("hex")}`
}

function cleanExpiredSessions(store: AdminStore): void {
  const now = Date.now()
  store.sessions = store.sessions.filter((s) => {
    const age = now - new Date(s.createdAt).getTime()
    return age < SESSION_TTL_MS
  })
}
