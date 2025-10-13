export function normalizeDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export function githubBaseUrl(enterprise?: string): string {
  if (!enterprise) return "https://github.com"
  return `https://${normalizeDomain(enterprise)}`
}

export function githubApiBaseUrl(enterprise?: string): string {
  if (!enterprise) return "https://api.github.com"
  const domain = normalizeDomain(enterprise) as string
  return `https://api.${domain}`
}

// small helper to validate a normalized host (basic check)
export function looksLikeHost(s: string | undefined): boolean {
  if (!s) return false
  // allow example.com or sub.example.com and digits/hyphen
  return /^[a-z0-9.-]+$/i.test(s)
}
