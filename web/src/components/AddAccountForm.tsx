import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "../api"
import { useT } from "../i18n"

interface Props {
  onComplete: () => Promise<void>
  onCancel: () => void
}

type Step = "config" | "authorize" | "done"

function DeviceCodeDisplay({
  userCode,
  verificationUri,
}: {
  userCode: string
  verificationUri: string
}) {
  const t = useT()
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginBottom: 16,
        }}
      >
        {t("enterCode")}
      </p>
      <div
        onClick={() => void navigator.clipboard.writeText(userCode)}
        style={{
          display: "inline-block",
          padding: "12px 24px",
          background: "var(--bg)",
          border: "2px solid var(--accent)",
          borderRadius: "var(--radius)",
          fontSize: 28,
          fontWeight: 700,
          fontFamily: "monospace",
          letterSpacing: 4,
          cursor: "pointer",
          userSelect: "all",
          marginBottom: 8,
        }}
        title="Click to copy"
      >
        {userCode}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("clickToCopy")}
      </p>
      <a
        href={verificationUri}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          padding: "8px 20px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: "var(--radius)",
          textDecoration: "none",
          fontSize: 14,
        }}
      >
        {t("openGithub")}
      </a>
    </div>
  )
}

function AuthorizeStep({
  userCode,
  verificationUri,
  authStatus,
  error,
  onCancel,
}: {
  userCode: string
  verificationUri: string
  authStatus: string
  error: string
  onCancel: () => void
}) {
  const t = useT()
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
        {t("githubAuth")}
      </h3>
      <DeviceCodeDisplay
        userCode={userCode}
        verificationUri={verificationUri}
      />
      <p
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 16,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--yellow)",
            animation: "pulse 1.5s infinite",
          }}
        />
        {authStatus}
      </p>
      {error && (
        <div
          style={{
            color: "var(--red)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  )
}

function ConfigForm({
  onSubmit,
  onCancel,
  loading,
  error,
  name,
  setName,
  accountType,
  setAccountType,
}: {
  onSubmit: (e: React.SyntheticEvent) => void
  onCancel: () => void
  loading: boolean
  error: string
  name: string
  setName: (v: string) => void
  accountType: string
  setAccountType: (v: string) => void
}) {
  const t = useT()
  return (
    <form onSubmit={onSubmit}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
        {t("addAccountTitle")}
      </h3>
      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <div>
          <label htmlFor="acc-name">{t("accountName")}</label>
          <input
            id="acc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("accountNamePlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="acc-type">{t("accountType")}</label>
          <select
            id="acc-type"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
          >
            <option value="individual">{t("individual")}</option>
            <option value="business">{t("business")}</option>
            <option value="enterprise">{t("enterprise")}</option>
          </select>
        </div>
      </div>
      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className="primary" disabled={loading}>
          {loading ? t("starting") : t("loginWithGithub")}
        </button>
      </div>
    </form>
  )
}

function useAuthFlow(onComplete: () => Promise<void>) {
  const [step, setStep] = useState<Step>("config")
  const [userCode, setUserCode] = useState("")
  const [verificationUri, setVerificationUri] = useState("")
  const [authStatus, setAuthStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const t = useT()

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startAuth = async (name: string, accountType: string) => {
    setError("")
    setLoading(true)
    try {
      const result = await api.startDeviceCode()
      setUserCode(result.userCode)
      setVerificationUri(result.verificationUri)
      setStep("authorize")
      setAuthStatus(t("waitingAuth"))

      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const poll = await api.pollAuth(result.sessionId)
            if (poll.status === "completed") {
              cleanup()
              setAuthStatus(t("authorized"))
              await api.completeAuth({
                sessionId: result.sessionId,
                name,
                accountType,
              })
              setStep("done")
              await onComplete()
            } else if (poll.status === "expired" || poll.status === "error") {
              cleanup()
              setAuthStatus("")
              setError(poll.error ?? t("authFailed"))
            }
          } catch {
            // poll error, keep trying
          }
        })()
      }, 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return {
    step,
    userCode,
    verificationUri,
    authStatus,
    loading,
    error,
    setError,
    cleanup,
    startAuth,
  }
}

export function AddAccountForm({ onComplete, onCancel }: Props) {
  const [name, setName] = useState("")
  const [accountType, setAccountType] = useState("individual")
  const auth = useAuthFlow(onComplete)
  const t = useT()

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      auth.setError(t("accountNameRequired"))
      return
    }
    void auth.startAuth(name.trim(), accountType)
  }

  if (auth.step === "done") return null

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 20,
        marginBottom: 16,
      }}
    >
      {auth.step === "config" && (
        <ConfigForm
          onSubmit={handleSubmit}
          onCancel={onCancel}
          loading={auth.loading}
          error={auth.error}
          name={name}
          setName={setName}
          accountType={accountType}
          setAccountType={setAccountType}
        />
      )}
      {auth.step === "authorize" && (
        <AuthorizeStep
          userCode={auth.userCode}
          verificationUri={auth.verificationUri}
          authStatus={auth.authStatus}
          error={auth.error}
          onCancel={() => {
            auth.cleanup()
            onCancel()
          }}
        />
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
