import type { State } from "./state"

/** Standard HTTP headers for JSON requests. */
export const standardHeaders = () => ({
  "content-type": "application/json",
  accept: "application/json",
})

/** Base URL for the GitHub Copilot API, determined by account type. */
export const copilotBaseUrl = (state: State) =>
  `https://api.${state.accountType}.githubcopilot.com`

/** Headers required for requests to the Copilot API. */
export const copilotHeaders = (state: State) => ({
  Authorization: `Bearer ${state.copilotToken}`,
  "content-type": standardHeaders()["content-type"],
  "copilot-integration-id": "vscode-chat",
  "editor-version": `vscode/${state.vsCodeVersion}`,
  "editor-plugin-version": "copilot-chat/0.24.1",
  "openai-intent": "conversation-panel",
  "x-github-api-version": "2024-12-15",
  "x-request-id": (globalThis.crypto as any).randomUUID(),
  "x-vscode-user-agent-library-version": "electron-fetch",
  "Copilot-Vision-Request": JSON.stringify({ enable: true }),
})

/** Base URL for the standard GitHub API. */
export const GITHUB_API_BASE_URL = "https://api.github.com"

/** Headers required for requests to the GitHub API (e.g., for user info, token generation). */
export const githubHeaders = (state: State) => ({
  ...standardHeaders(),
  authorization: `token ${state.githubToken}`,
  "editor-version": `vscode/${state.vsCodeVersion}`,
  "editor-plugin-version": "copilot-chat/0.24.1",
  "user-agent": "GitHubCopilotChat/0.24.1",
  "x-github-api-version": "2024-12-15",
  "x-vscode-user-agent-library-version": "electron-fetch",
})

/** Base URL for GitHub web flows (e.g., device code authentication). */
export const GITHUB_BASE_URL = "https://github.com"

/** Client ID used for the GitHub OAuth device flow. */
export const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98"

/** OAuth scopes requested during the device flow. */
export const GITHUB_APP_SCOPES = ["read:user"].join(" ")
