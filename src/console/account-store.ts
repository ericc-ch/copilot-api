import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

export interface Account {
  id: string
  name: string
  githubToken: string
  accountType: string
  apiKey: string
  enabled: boolean
  createdAt: string
  priority: number
}

export interface PoolConfig {
  enabled: boolean
  strategy: "round-robin" | "priority"
  apiKey: string
}

export interface AccountStore {
  accounts: Array<Account>
  pool?: PoolConfig
}

const STORE_PATH = path.join(PATHS.APP_DIR, "accounts.json")

function generateApiKey(): string {
  return `cpa-${crypto.randomBytes(16).toString("hex")}`
}

async function readStore(): Promise<AccountStore> {
  try {
    const data = await fs.readFile(STORE_PATH)
    return JSON.parse(data) as AccountStore
  } catch {
    return { accounts: [] }
  }
}

async function writeStore(store: AccountStore): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2))
}

export async function getAccounts(): Promise<Array<Account>> {
  const store = await readStore()
  return store.accounts
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const store = await readStore()
  return store.accounts.find((a) => a.id === id)
}

export async function getAccountByApiKey(
  apiKey: string,
): Promise<Account | undefined> {
  const store = await readStore()
  return store.accounts.find((a) => a.apiKey === apiKey)
}

export async function addAccount(
  account: Omit<Account, "id" | "createdAt" | "apiKey" | "priority"> & {
    priority?: number
  },
): Promise<Account> {
  const store = await readStore()
  const newAccount: Account = {
    ...account,
    id: crypto.randomUUID(),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
    priority: account.priority ?? 0,
  }
  store.accounts.push(newAccount)
  await writeStore(store)
  return newAccount
}

export async function updateAccount(
  id: string,
  updates: Partial<Omit<Account, "id" | "createdAt" | "apiKey">>,
): Promise<Account | undefined> {
  const store = await readStore()
  const index = store.accounts.findIndex((a) => a.id === id)
  if (index === -1) return undefined
  store.accounts[index] = { ...store.accounts[index], ...updates }
  await writeStore(store)
  return store.accounts[index]
}

export async function deleteAccount(id: string): Promise<boolean> {
  const store = await readStore()
  const index = store.accounts.findIndex((a) => a.id === id)
  if (index === -1) return false
  store.accounts.splice(index, 1)
  await writeStore(store)
  return true
}

export async function regenerateApiKey(
  id: string,
): Promise<Account | undefined> {
  const store = await readStore()
  const index = store.accounts.findIndex((a) => a.id === id)
  if (index === -1) return undefined
  store.accounts[index] = { ...store.accounts[index], apiKey: generateApiKey() }
  await writeStore(store)
  return store.accounts[index]
}

export async function getPoolConfig(): Promise<PoolConfig | undefined> {
  const store = await readStore()
  if (!store.pool) return undefined
  // Backfill apiKey for legacy stores
  if (!store.pool.apiKey) {
    store.pool.apiKey = generatePoolApiKey()
    await writeStore(store)
  }
  return store.pool
}

export async function updatePoolConfig(
  config: Partial<PoolConfig>,
): Promise<PoolConfig> {
  const store = await readStore()
  const current: PoolConfig = store.pool ?? {
    enabled: false,
    strategy: "round-robin",
    apiKey: generatePoolApiKey(),
  }
  store.pool = { ...current, ...config }
  // Ensure apiKey exists for legacy stores
  if (!store.pool.apiKey) {
    store.pool.apiKey = generatePoolApiKey()
  }
  await writeStore(store)
  return store.pool
}

export async function regeneratePoolApiKey(): Promise<PoolConfig> {
  const store = await readStore()
  const current: PoolConfig = store.pool ?? {
    enabled: false,
    strategy: "round-robin",
    apiKey: generatePoolApiKey(),
  }
  current.apiKey = generatePoolApiKey()
  store.pool = current
  await writeStore(store)
  return store.pool
}

function generatePoolApiKey(): string {
  return `cpp-${crypto.randomBytes(16).toString("hex")}`
}
