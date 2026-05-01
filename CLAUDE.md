# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```sh
bun install          # Install dependencies
bun run dev          # Run in dev mode with hot reload
bun run build        # Build for production (tsdown)
bun run start        # Run production build
bun run lint         # Lint with eslint
bun run lint:all     # Lint all files
bun run typecheck    # Type check with tsc
bun test             # Run all tests
bun test tests/foo.test.ts  # Run single test file
```

Pre-commit hooks run `lint --fix` via lint-staged automatically.

## Architecture Overview

**Core Structure:**
- `src/main.ts` - CLI entry point using `citty`, defines subcommands (start, auth, check-usage, debug)
- `src/start.ts` - Main server startup logic, handles authentication flow
- `src/server.ts` - Hono server with routes for OpenAI & Anthropic compatible APIs
- `src/auth.ts` - GitHub OAuth device flow authentication

**Request Flow:**
1. CLI command parsed by citty → `start.ts` handles auth/token refresh
2. Token stored in `~/.local/share/copilot-api/` via `src/lib/paths.ts`
3. Server starts on port 4141 (default) with Hono
4. Incoming requests translated from OpenAI/Anthropic format → GitHub Copilot API

**Key Services:**
- `src/services/github/*` - GitHub API calls (device code, access token, user, copilot token)
- `src/services/copilot/*` - Copilot API calls (chat completions, embeddings, models)
- `src/routes/*` - API route handlers with format translation

**Libraries:**
- `src/lib/*` - Rate limiting, manual approval, proxy, tokenizer, state management

**Route Structure:**
- `/v1/chat/completions` - OpenAI compatible (translates to Copilot API)
- `/v1/messages` - Anthropic Messages API compatible
- `/v1/models` - Lists available models
- `/v1/embeddings` - OpenAI compatible embeddings
- `/usage` - Copilot usage/quota monitoring
- `/token` - Current Copilot token info

## Code Style

- **Imports:** ESNext modules, use `~/*` path alias for `src/*`
- **Types:** Strict mode, explicit types, no `any`
- **Naming:** `camelCase` variables/functions, `PascalCase` types/classes
- **Error Handling:** Use custom error classes from `src/lib/error.ts`
- **Testing:** Bun test runner, tests in `tests/*.test.ts`

## Configuration Files

- `tsconfig.json` - TypeScript config with path aliases (`~/*` → `src/*`)
- `tsdown.config.ts` - Build configuration (ESM, es2022 target, Node platform)
- `eslint.config.js` - Linting rules (@echristian/eslint-config)
- `package.json` - Scripts, dependencies, lint-staged config

## State & Data Management

**Runtime State:** `src/lib/state.ts` - In-memory state object storing:
- GitHub/Copilot tokens
- Account type, models, VSCode version cache
- Rate limiting config and request timestamps
- Manual approval flag

**Persistent Data:** Tokens stored in `~/.local/share/copilot-api/` (see `src/lib/paths.ts`)

## Testing Patterns

- Test files in `tests/*.test.ts`
- Examples: `anthropic-request.test.ts`, `anthropic-response.test.ts`, `create-chat-completions.test.ts`
- Tests focus on request/response translation between OpenAI/Anthropic formats and Copilot API
