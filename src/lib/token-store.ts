import { Database } from "bun:sqlite"

import { PATHS } from "./paths"

interface TokenUsageRow {
  timestamp_min: number
  model: string
  input_tokens: number
  output_tokens: number
  request_count: number
}

let db: Database | null = null

const getDb = (): Database => {
  if (!db)
    throw new Error("Token store not initialized. Call initTokenStore() first.")
  return db
}

export const initTokenStore = (): void => {
  db = new Database(PATHS.TOKEN_USAGE_DB_PATH)

  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      timestamp_min INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (timestamp_min, model)
    )
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp
    ON token_usage (timestamp_min)
  `)
}

const currentMinuteBucket = (): number =>
  Math.floor(Date.now() / 1000 / 60) * 60

const pruneOldData = (): void => {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
  getDb().run("DELETE FROM token_usage WHERE timestamp_min < ?", [
    thirtyDaysAgo,
  ])
}

export const recordTokenUsage = (
  model: string,
  inputTokens: number,
  outputTokens: number,
): void => {
  try {
    const bucket = currentMinuteBucket()

    getDb().run(
      `INSERT INTO token_usage (timestamp_min, model, input_tokens, output_tokens, request_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (timestamp_min, model) DO UPDATE SET
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         request_count = request_count + 1`,
      [bucket, model, inputTokens, outputTokens],
    )

    pruneOldData()
  } catch (error) {
    // Never let storage errors surface to callers
    console.error("[token-store] Failed to record token usage:", error)
  }
}

export interface TokenUsageSummary {
  total_input: number
  total_output: number
  total_requests: number
  models: Array<string>
}

export interface TokenUsageResponse {
  range: string
  data: Array<TokenUsageRow>
  summary: TokenUsageSummary
}

const RANGE_LABELS: Record<string, string> = {
  "3600": "1h",
  "21600": "6h",
  "86400": "24h",
  "604800": "7d",
  "2592000": "30d",
}

export const getTokenUsageData = (rangeSeconds: number): TokenUsageResponse => {
  const since = Math.floor(Date.now() / 1000) - rangeSeconds

  const rows = getDb()
    .query<TokenUsageRow, [number]>(
      `SELECT timestamp_min, model, input_tokens, output_tokens, request_count
       FROM token_usage
       WHERE timestamp_min >= ?
       ORDER BY timestamp_min ASC`,
    )
    .all(since)

  const summary: TokenUsageSummary = {
    total_input: 0,
    total_output: 0,
    total_requests: 0,
    models: [],
  }

  const modelSet = new Set<string>()
  for (const row of rows) {
    summary.total_input += row.input_tokens
    summary.total_output += row.output_tokens
    summary.total_requests += row.request_count
    modelSet.add(row.model)
  }
  summary.models = [...modelSet].sort()

  return {
    range: RANGE_LABELS[String(rangeSeconds)] ?? `${rangeSeconds}s`,
    data: rows,
    summary,
  }
}
