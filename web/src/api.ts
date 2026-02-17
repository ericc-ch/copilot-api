const BASE = "/api"

let sessionToken = ""

export function setSessionToken(token: string): void {
  sessionToken = token
  if (token) {
    localStorage.setItem("sessionToken", token)
  } else {
    localStorage.removeItem("sessionToken")
  }
}

export function getSessionToken(): string {
  if (!sessionToken) {
    sessionToken = localStorage.getItem("sessionToken") ?? ""
  }
  return sessionToken
}

export interface Account {
  id: string
  name: string
  githubToken: string
  accountType: string
  apiKey: string
  enabled: boolean
  createdAt: string
  priority: number
  status?: "running" | "stopped" | "error"
  error?: string
  user?: { login: string } | null
}

export interface UsageData {
  copilot_plan: string
  quota_reset_date: string
  quota_snapshots: {
    premium_interactions: QuotaDetail
    chat: QuotaDetail
    completions: QuotaDetail
  }
}

interface QuotaDetail {
  entitlement: number
  remaining: number
  percent_remaining: number
}

export interface PoolConfig {
  enabled: boolean
  strategy: "round-robin" | "priority"
  apiKey: string
}

export interface DeviceCodeResponse {
  sessionId: string
  userCode: string
  verificationUri: string
  expiresIn: number
}

export interface AuthPollResponse {
  status: "pending" | "completed" | "expired" | "error"
  accessToken?: string
  error?: string
}

export interface ConfigResponse {
  proxyPort: number
  needsSetup: boolean
}

export interface BatchUsageItem {
  accountId: string
  name: string
  status: string
  usage: UsageData | null
}

interface ErrorBody {
  error?: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  }
  const token = getSessionToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getConfig: () => request<ConfigResponse>("/config"),

  setup: (username: string, password: string) =>
    request<{ token: string }>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  checkAuth: () => request<{ ok: boolean }>("/auth/check"),

  getAccounts: () => request<Array<Account>>("/accounts"),

  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),

  startInstance: (id: string) =>
    request<{ status: string }>(`/accounts/${id}/start`, { method: "POST" }),

  stopInstance: (id: string) =>
    request<{ status: string }>(`/accounts/${id}/stop`, { method: "POST" }),

  getUsage: (id: string) => request<UsageData>(`/accounts/${id}/usage`),

  getAllUsage: () => request<Array<BatchUsageItem>>("/accounts/usage"),

  regenerateKey: (id: string) =>
    request<Account>(`/accounts/${id}/regenerate-key`, { method: "POST" }),

  startDeviceCode: () =>
    request<DeviceCodeResponse>("/auth/device-code", { method: "POST" }),

  pollAuth: (sessionId: string) =>
    request<AuthPollResponse>(`/auth/poll/${sessionId}`),

  completeAuth: (data: {
    sessionId: string
    name: string
    accountType: string
  }) =>
    request<Account>("/auth/complete", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateAccount: (id: string, data: Record<string, unknown>) =>
    request<Account>(`/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getPool: () => request<PoolConfig>("/pool"),

  updatePool: (data: Partial<PoolConfig>) =>
    request<PoolConfig>("/pool", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  regeneratePoolKey: () =>
    request<PoolConfig>("/pool/regenerate-key", { method: "POST" }),
}
