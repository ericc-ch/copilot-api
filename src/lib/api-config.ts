import type { State } from "./state"

/**
 * Standard HTTP headers for JSON requests.
 * @returns Object with standard JSON content headers
 */
export const standardHeaders = () => ({
  "content-type": "application/json",
  accept: "application/json",
})

/**
 * Base URL for the GitHub Copilot API, determined by account type.
 * @param state Application state containing account type
 * @returns The Copilot API base URL
 */
export const copilotBaseUrl = (state: State) =>
  `https://api.${state.accountType}.githubcopilot.com`

/**
 * Safely get a UUID from the crypto API
 * @returns A random UUID string
 */
function getRequestId(): string {
  // Check if crypto API is available with randomUUID
  // Using type assertion for newer Crypto APIs that might not be in TypeScript definitions
  const crypto = globalThis.crypto as unknown as { randomUUID?: () => string }
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback for environments where randomUUID isn't available
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replaceAll(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Headers required for requests to the Copilot API.
 * @param state Application state containing tokens
 * @returns Object with all required headers for Copilot API
 */
export const copilotHeaders = (state: State) => ({
  Authorization: `Bearer ${state.copilotToken}`,
  "content-type": standardHeaders()["content-type"],
  accept: "application/json",
  "editor-plugin-version": "copilot-chat/0.24.1",
  "openai-intent": "conversation-panel",
  "x-github-api-version": "2024-12-15",
  "x-request-id": getRequestId(),
  "x-vscode-user-agent-library-version": "electron-fetch",
  "Copilot-Vision-Request": JSON.stringify({ enable: true }),
  "Editor-Version":
    state.vsCodeVersion ? `vscode/${state.vsCodeVersion}` : undefined,
})

/** Base URL for the standard GitHub API. */
export const GITHUB_API_BASE_URL = "https://api.github.com"

/**
 * Headers required for requests to the GitHub API (e.g., for user info, token generation).
 * @param state Application state containing tokens
 * @returns Object with all required headers for GitHub API
 */
export const githubHeaders = (state: State) => ({
  ...standardHeaders(),
  authorization: `token ${state.githubToken}`,
  "editor-version": state.vsCodeVersion,
  "editor-plugin-version": "copilot-chat/0.24.1",
  "vscode-sessionid": "ae5fb99a-6de2-453d-ba93-79d7a00ab79b",
  "vscode-machineid": "05274e52-a0bf-4330-a15a-45943f31fba1",
  "x-vscode-user-agent-library-version": "electron-fetch",
})

/** Base URL for GitHub web flows (e.g., device code authentication). */
export const GITHUB_BASE_URL = "https://github.com"

/** Client ID used for the GitHub OAuth device flow. */
export const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98"

/** OAuth scopes requested during the device flow. */
export const GITHUB_APP_SCOPES = ["read:user"].join(" ")
