import { useState } from "react"

import { api, type Account, type UsageData } from "../api"
import { useT } from "../i18n"

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    running: "var(--green)",
    stopped: "var(--text-muted)",
    error: "var(--red)",
  }
  const color = colorMap[status] ?? "var(--text-muted)"
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
        }}
      />
      {status}
    </span>
  )
}

function QuotaBar({
  label,
  used,
  total,
}: {
  label: string
  used: number
  total: number
}) {
  const pct = total > 0 ? (used / total) * 100 : 0
  let color = "var(--green)"
  if (pct > 90) color = "var(--red)"
  else if (pct > 70) color = "var(--yellow)"

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span>
          {used} / {total} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  )
}

function UsagePanel({ usage }: { usage: UsageData }) {
  const q = usage.quota_snapshots
  const t = useT()
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "var(--bg)",
        borderRadius: "var(--radius)",
      }}
    >
      <div
        style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}
      >
        {t("plan")} {usage.copilot_plan} · {t("resets")} {usage.quota_reset_date}
      </div>
      <QuotaBar
        label={t("premium")}
        used={
          q.premium_interactions.entitlement - q.premium_interactions.remaining
        }
        total={q.premium_interactions.entitlement}
      />
      <QuotaBar
        label={t("chat")}
        used={q.chat.entitlement - q.chat.remaining}
        total={q.chat.entitlement}
      />
      <QuotaBar
        label={t("completions")}
        used={q.completions.entitlement - q.completions.remaining}
        total={q.completions.entitlement}
      />
    </div>
  )
}

function useCopyFeedback(): [string | null, (text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }
  return [copied, copy]
}

function ApiKeyPanel({
  apiKey,
  onRegenerate,
}: {
  apiKey: string
  onRegenerate: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [copied, copy] = useCopyFeedback()
  const t = useT()
  const safeKey = apiKey ?? ""
  const masked = safeKey.length > 8 ? `${safeKey.slice(0, 8)}${"•".repeat(24)}` : safeKey
  const isCopied = copied === safeKey

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: "var(--bg)",
        borderRadius: "var(--radius)",
        fontSize: 12,
        fontFamily: "monospace",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
        {isCopied ? t("copied") : t("apiKey")}
      </span>
      <span
        onClick={() => copy(safeKey)}
        style={{
          cursor: "pointer",
          flex: 1,
          color: isCopied ? "var(--green)" : undefined,
        }}
        title="Click to copy"
      >
        {visible ? safeKey : masked}
      </span>
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        style={{ padding: "2px 8px", fontSize: 11 }}
      >
        {visible ? t("hide") : t("show")}
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        style={{ padding: "2px 8px", fontSize: 11 }}
      >
        {t("regen")}
      </button>
    </div>
  )
}

interface Props {
  account: Account
  proxyPort: number
  onRefresh: () => Promise<void>
}

function AccountActions({
  account,
  status,
  onRefresh,
  onToggleUsage,
  usageLoading,
  showUsage,
}: {
  account: Account
  status: string
  onRefresh: () => Promise<void>
  onToggleUsage: () => void
  usageLoading: boolean
  showUsage: boolean
}) {
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const t = useT()

  const handleAction = async (action: () => Promise<unknown>) => {
    setActionLoading(true)
    try {
      await action()
      await onRefresh()
    } catch (err) {
      console.error("Action failed:", err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    await handleAction(() => api.deleteAccount(account.id))
    setConfirmDelete(false)
  }

  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      {status === "running" && (
        <button onClick={onToggleUsage} disabled={usageLoading}>
          {usageLoading ? "..." : showUsage ? t("hideUsage") : t("usage")}
        </button>
      )}
      {status === "running" ?
        <button
          onClick={() => void handleAction(() => api.stopInstance(account.id))}
          disabled={actionLoading}
        >
          {t("stop")}
        </button>
      : <button
          className="primary"
          onClick={() => void handleAction(() => api.startInstance(account.id))}
          disabled={actionLoading}
        >
          {actionLoading ? t("starting") : t("start")}
        </button>
      }
      <button
        className="danger"
        onClick={() => void handleDelete()}
        disabled={actionLoading}
      >
        {confirmDelete ? t("confirmDelete") : t("delete")}
      </button>
    </div>
  )
}

function EndpointsPanel({ apiKey, proxyPort }: { apiKey: string; proxyPort: number }) {
  const proxyBase = `${window.location.protocol}//${window.location.hostname}:${proxyPort}`
  const safeKey = apiKey ?? "YOUR_API_KEY"
  const [copied, copy] = useCopyFeedback()
  const t = useT()

  const endpoints = [
    { label: "OpenAI", path: "/v1/chat/completions" },
    { label: "Anthropic", path: "/v1/messages" },
    { label: "Models", path: "/v1/models" },
    { label: "Embeddings", path: "/v1/embeddings" },
  ]

  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: "var(--bg)",
        borderRadius: "var(--radius)",
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: "var(--text-muted)",
          marginBottom: 6,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{t("endpoints")} (Bearer {safeKey.slice(0, 8)}...)</span>
        <span style={{ fontFamily: "monospace" }}>{proxyBase}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {endpoints.map((ep) => {
          const url = `${proxyBase}${ep.path}`
          const isCopied = copied === url
          return (
            <span
              key={ep.label}
              onClick={() => copy(url)}
              style={{
                padding: "2px 8px",
                background: isCopied ? "var(--green)" : "var(--bg-card)",
                color: isCopied ? "#fff" : undefined,
                border: `1px solid ${isCopied ? "var(--green)" : "var(--border)"}`,
                borderRadius: 4,
                fontFamily: "monospace",
                cursor: "pointer",
                fontSize: 11,
                transition: "all 0.2s",
              }}
              title={url}
            >
              {isCopied ? t("copied") : ep.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function AccountCard({ account, proxyPort, onRefresh }: Props) {
  const status = account.status ?? "stopped"
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const [editingPriority, setEditingPriority] = useState(false)
  const [priorityValue, setPriorityValue] = useState(
    String(account.priority ?? 0),
  )
  const t = useT()

  const handleToggleUsage = async () => {
    if (showUsage) {
      setShowUsage(false)
      return
    }
    setUsageLoading(true)
    try {
      const data = await api.getUsage(account.id)
      setUsage(data)
      setShowUsage(true)
    } catch {
      setUsage(null)
      setShowUsage(true)
    } finally {
      setUsageLoading(false)
    }
  }

  const handleRegenerate = () => {
    void (async () => {
      try {
        await api.regenerateKey(account.id)
        await onRefresh()
      } catch (err) {
        console.error("Regenerate failed:", err)
      }
    })()
  }

  const handlePrioritySave = () => {
    const num = parseInt(priorityValue, 10)
    if (isNaN(num) || num < 0) {
      setPriorityValue(String(account.priority ?? 0))
      setEditingPriority(false)
      return
    }
    setEditingPriority(false)
    if (num !== (account.priority ?? 0)) {
      void (async () => {
        try {
          await api.updateAccount(account.id, { priority: num })
          await onRefresh()
        } catch (err) {
          console.error("Priority update failed:", err)
          setPriorityValue(String(account.priority ?? 0))
        }
      })()
    }
  }

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {account.name}
            </span>
            <StatusBadge status={status} />
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {account.user?.login ? `@${account.user.login} · ` : ""}
            {account.accountType}
          </div>
          {account.error && (
            <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>
              {t("error")} {account.error}
            </div>
          )}
        </div>

        <AccountActions
          account={account}
          status={status}
          onRefresh={onRefresh}
          onToggleUsage={() => void handleToggleUsage()}
          usageLoading={usageLoading}
          showUsage={showUsage}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{t("priorityLabel")}</span>
        {editingPriority ? (
          <input
            type="number"
            value={priorityValue}
            onChange={(e) => setPriorityValue(e.target.value)}
            onBlur={handlePrioritySave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePrioritySave()
              if (e.key === "Escape") {
                setPriorityValue(String(account.priority ?? 0))
                setEditingPriority(false)
              }
            }}
            autoFocus
            min={0}
            style={{
              width: 60,
              padding: "2px 6px",
              fontSize: 13,
              display: "inline-block",
            }}
          />
        ) : (
          <span
            onClick={() => setEditingPriority(true)}
            style={{
              cursor: "pointer",
              padding: "2px 10px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontFamily: "monospace",
              fontSize: 13,
            }}
            title="Click to edit"
          >
            {account.priority ?? 0}
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("priorityHint")}
        </span>
      </div>

      <ApiKeyPanel apiKey={account.apiKey} onRegenerate={handleRegenerate} />
      {status === "running" && (
        <EndpointsPanel apiKey={account.apiKey} proxyPort={proxyPort} />
      )}
      {showUsage
        && (usage ?
          <UsagePanel usage={usage} />
        : <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            {t("usageUnavailable")}
          </div>)}
    </div>
  )
}
