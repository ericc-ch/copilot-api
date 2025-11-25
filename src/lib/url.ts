export function normalizeDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export function githubBaseUrl(enterprise?: string): string {
  if (!enterprise) return "https://github.com"
  const domain = normalizeDomain(enterprise)
  return `https://${domain}`
}

export function githubApiBaseUrl(enterprise?: string): string {
  if (!enterprise) return "https://api.github.com"
  const domain = normalizeDomain(enterprise)
  return `https://api.${domain}`
}
