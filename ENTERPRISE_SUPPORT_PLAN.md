# Enterprise Support Implementation Plan

Goal

Enable GitHub Enterprise / GitHub Enterprise Server support so copilot-api can authenticate against enterprise installs and fetch Copilot tokens and usage from enterprise endpoints.

Design principles

- Backwards compatible: default behavior remains GitHub.com when no enterprise host is configured.
- Minimal invasive: add a persisted enterprise host value and thread it through existing OAuth and Copilot token flows.
- Simple UX: interactive auth prompts for users, and --enterprise-url flags for scripting.

What will change

1. New helper: src/lib/url.ts
   - normalizeDomain(url) to strip scheme and trailing slashes.
   - githubBaseUrl(enterprise?) and githubApiBaseUrl(enterprise?) to build correct endpoints.
   - looksLikeHost() for basic validation.

2. Persisted enterprise host
   - Add PATHS.ENTERPRISE_URL (APP_DIR/enterprise_url)
   - ensurePaths() will create and set permissions for it.

3. Thread enterprise host through flows
   - getDeviceCode(enterpriseUrl?) -> uses https://{enterprise}/login/device/code
   - pollAccessToken(deviceCode, enterpriseUrl?) -> https://{enterprise}/login/oauth/access_token
   - getCopilotToken() -> uses GITHUB_API_BASE_URL(state.enterpriseUrl)/copilot_internal/v2/token
   - getCopilotUsage() -> uses GITHUB_API_BASE_URL(state.enterpriseUrl)/copilot_internal/user

4. Runtime state
   - state.enterpriseUrl?: string
   - setupGitHubToken will read persisted enterprise_url and set state.enterpriseUrl
   - setupGitHubToken(options) accepts options.enterpriseUrl to support scripted auth

5. CLI UX
   - auth: new --enterprise-url flag; if omitted, interactive prompt: "Use GitHub Enterprise? (y/N)" then ask for host. Persist host when provided.
   - start: new --enterprise-url flag which overrides persisted value (if present) for that run.
   - If account-type=enterprise and no enterprise host is available, provide a clear error directing the user to run auth or pass --enterprise-url.

6. Files to modify
- src/lib/paths.ts (ENTERPRISE_URL_PATH + ensurePaths)
- src/lib/url.ts (new)
- src/lib/api-config.ts (GITHUB_API_BASE_URL and GITHUB_BASE_URL helpers)
- src/lib/state.ts (add enterpriseUrl)
- src/services/github/get-device-code.ts (accept enterpriseUrl)
- src/services/github/poll-access-token.ts (accept enterpriseUrl)
- src/services/github/get-copilot-token.ts (use state.enterpriseUrl)
- src/services/github/get-copilot-usage.ts (use state.enterpriseUrl)
- src/lib/token.ts (persist/read enterprise_url, wire state, pass enterpriseUrl to flows)
- src/auth.ts (add --enterprise-url flag and interactive prompt)
- src/start.ts (add --enterprise-url flag and wire through runServer)
- README.md and CLAUDE.md (document new flags)
- tests/ (add unit tests for normalizeDomain and base builders)

7. Tests and validation
- Unit tests for normalizeDomain, githubBaseUrl, githubApiBaseUrl
- Integration test mocking fetch to assert correct host used when enterpriseUrl present
- Manual test steps documented in README

8. PR checklist
- [ ] Lint (bun run lint)
- [ ] Build (bun run build)
- [ ] Typecheck (bun run typecheck)
- [ ] Unit tests added and green
- [ ] README/CLAUDE.md updated
- [ ] Security review: tokens persisted under APP_DIR with 0600

Migration and compatibility

- Existing users: no change unless they opt into enterprise.
- New behavior: when enterprise_url file is present, the CLI will use that host automatically unless overriden with --enterprise-url.

Implementation notes & alternatives

- The plan persists enterprise host in a simple text file next to the existing token file to minimize format changes. If you prefer a single JSON blob for all metadata, we can migrate PATHS.GITHUB_TOKEN_PATH to a JSON file, but that is a larger migration and risk.
- For interactive prompts I used the existing project pattern with consola.prompt where available; if consola.prompt isn't adequate, we can add a small dependency like `prompts`.

Next steps (prioritized)

1. Finish wiring OAuth and Copilot token calls to use enterpriseUrl across services (high priority)
   - Ensure every fetch that previously used GITHUB_API_BASE_URL/GITHUB_BASE_URL now uses the helper with state.enterpriseUrl where appropriate.

2. Add CLI flags and interactive prompts (auth/start) (high priority)
   - Finalize the auth interactive flow using consola.prompt to avoid extra dependencies.
   - Add --enterprise-url flag to both auth and start commands and wire through runServer/setupGitHubToken.

3. Add unit tests for URL helpers (medium)
   - normalizeDomain, githubBaseUrl, githubApiBaseUrl.

4. Update README.md and CLAUDE.md with examples and instructions for enterprise usage (medium)

5. Run lint/build/typecheck and fix any issues (high)

6. Open a branch, commit changes, and create PR with description and checklist (high)

7. Add integration tests or manual test docs if real GHE instance is available (optional)

I will proceed to finish wiring the remaining call sites and finalize CLI flags unless you want me to stop or adjust priorities.