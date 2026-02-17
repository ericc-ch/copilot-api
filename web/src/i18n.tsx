import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

export type Locale = "en" | "zh"

const STORAGE_KEY = "copilot-api-locale"

const en = {
  // Common
  loading: "Loading...",
  cancel: "Cancel",
  copied: "Copied!",
  hide: "Hide",
  show: "Show",
  regen: "Regen",

  // Auth
  consoleTitle: "Copilot API Console",
  setupSubtitle: "Create your admin account to get started",
  loginSubtitle: "Sign in to continue",
  usernamePlaceholder: "Username",
  passwordPlaceholder: "Password (min 6 chars)",
  confirmPasswordPlaceholder: "Confirm password",
  passwordMismatch: "Passwords do not match",
  passwordTooShort: "Password must be at least 6 characters",
  creating: "Creating...",
  createAdmin: "Create Admin Account",
  signingIn: "Signing in...",
  signIn: "Sign In",
  invalidCredentials: "Invalid username or password",
  logout: "Logout",

  // Dashboard
  dashboardSubtitle: "Manage multiple GitHub Copilot proxy accounts",
  addAccount: "+ Add Account",
  noAccounts: "No accounts configured",
  noAccountsHint: "Add a GitHub account to get started",

  // Pool
  poolMode: "Pool Mode",
  poolEnabledDesc: "Requests with pool key are load-balanced across running accounts",
  poolDisabledDesc: "Enable to auto-distribute requests across accounts",
  disable: "Disable",
  enable: "Enable",
  roundRobin: "Round Robin",
  priority: "Priority",
  roundRobinDesc: "Evenly distribute across accounts",
  priorityDesc: "Prefer higher-priority accounts first",
  poolKey: "Pool Key:",
  baseUrl: "Base URL:",

  // Account Card
  apiKey: "API Key:",
  endpoints: "Endpoints",
  priorityLabel: "Priority:",
  priorityHint: "Higher value = higher priority",
  usageUnavailable: "Usage data unavailable. Make sure the instance is running.",
  usage: "Usage",
  hideUsage: "Hide Usage",
  stop: "Stop",
  start: "Start",
  starting: "Starting...",
  delete: "Delete",
  confirmDelete: "Confirm?",
  plan: "Plan:",
  resets: "Resets:",
  premium: "Premium",
  chat: "Chat",
  completions: "Completions",
  error: "Error:",

  // Add Account
  addAccountTitle: "Add Account",
  accountName: "Account Name",
  accountNamePlaceholder: "e.g. Personal",
  accountType: "Account Type",
  individual: "Individual",
  business: "Business",
  enterprise: "Enterprise",
  loginWithGithub: "Login with GitHub",
  accountNameRequired: "Account name is required",

  // GitHub Auth
  githubAuth: "GitHub Authorization",
  enterCode: "Enter this code on GitHub:",
  clickToCopy: "Click the code to copy",
  openGithub: "Open GitHub",
  waitingAuth: "Waiting for authorization...",
  authorized: "Authorized! Creating account...",
  authFailed: "Authorization failed or expired",

  // Batch Usage
  batchUsage: "Batch Usage Query",
  queryAllUsage: "Query All Usage",
  refreshing: "Querying...",
  colAccount: "Account",
  colStatus: "Status",
  colPlan: "Plan",
  colPremium: "Premium",
  colChat: "Chat",
  colCompletions: "Completions",
  colResets: "Resets",
  totalSummary: "Total",
  noRunningAccounts: "No running accounts",
} as const

export type TranslationKey = keyof typeof en
type Translations = Record<TranslationKey, string>

const zh: Translations = {
  // Common
  loading: "加载中...",
  cancel: "取消",
  copied: "已复制！",
  hide: "隐藏",
  show: "显示",
  regen: "重新生成",

  // Auth
  consoleTitle: "Copilot API 控制台",
  setupSubtitle: "创建管理员账户以开始使用",
  loginSubtitle: "登录以继续",
  usernamePlaceholder: "用户名",
  passwordPlaceholder: "密码（至少 6 位）",
  confirmPasswordPlaceholder: "确认密码",
  passwordMismatch: "两次输入的密码不一致",
  passwordTooShort: "密码至少需要 6 个字符",
  creating: "创建中...",
  createAdmin: "创建管理员账户",
  signingIn: "登录中...",
  signIn: "登录",
  invalidCredentials: "用户名或密码错误",
  logout: "退出登录",

  // Dashboard
  dashboardSubtitle: "管理多个 GitHub Copilot 代理账户",
  addAccount: "+ 添加账户",
  noAccounts: "暂无账户",
  noAccountsHint: "添加一个 GitHub 账户以开始使用",

  // Pool
  poolMode: "池模式",
  poolEnabledDesc: "使用池密钥的请求将在运行中的账户间负载均衡",
  poolDisabledDesc: "启用后可自动分配请求到各账户",
  disable: "禁用",
  enable: "启用",
  roundRobin: "轮询",
  priority: "优先级",
  roundRobinDesc: "均匀分配到各账户",
  priorityDesc: "优先使用高优先级账户",
  poolKey: "池密钥：",
  baseUrl: "基础 URL：",

  // Account Card
  apiKey: "API 密钥：",
  endpoints: "接口端点",
  priorityLabel: "优先级：",
  priorityHint: "数值越大优先级越高",
  usageUnavailable: "用量数据不可用，请确保实例正在运行。",
  usage: "用量",
  hideUsage: "隐藏用量",
  stop: "停止",
  start: "启动",
  starting: "启动中...",
  delete: "删除",
  confirmDelete: "确认？",
  plan: "计划：",
  resets: "重置：",
  premium: "高级",
  chat: "对话",
  completions: "补全",
  error: "错误：",

  // Add Account
  addAccountTitle: "添加账户",
  accountName: "账户名称",
  accountNamePlaceholder: "例如：个人",
  accountType: "账户类型",
  individual: "个人",
  business: "商业",
  enterprise: "企业",
  loginWithGithub: "使用 GitHub 登录",
  accountNameRequired: "请输入账户名称",

  // GitHub Auth
  githubAuth: "GitHub 授权",
  enterCode: "在 GitHub 上输入此代码：",
  clickToCopy: "点击代码即可复制",
  openGithub: "打开 GitHub",
  waitingAuth: "等待授权中...",
  authorized: "已授权！正在创建账户...",
  authFailed: "授权失败或已过期",

  // Batch Usage
  batchUsage: "批量额度查询",
  queryAllUsage: "查询所有额度",
  refreshing: "查询中...",
  colAccount: "账户",
  colStatus: "状态",
  colPlan: "计划",
  colPremium: "高级",
  colChat: "对话",
  colCompletions: "补全",
  colResets: "重置日期",
  totalSummary: "合计",
  noRunningAccounts: "暂无运行中的账户",
} as const

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getInitialLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === "en" || saved === "zh") return saved
  const lang = navigator.language
  if (lang.startsWith("zh")) return "zh"
  return "en"
}

const translations: Record<Locale, Translations> = { en, zh }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback(
    (key: TranslationKey) => translations[locale][key],
    [locale],
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useT must be used within I18nProvider")
  return ctx.t
}

export function useLocale() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useLocale must be used within I18nProvider")
  return { locale: ctx.locale, setLocale: ctx.setLocale }
}
