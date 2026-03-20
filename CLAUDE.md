# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

copilot-api is a reverse proxy that exposes GitHub Copilot as OpenAI and Anthropic-compatible API endpoints. Built with Bun, TypeScript, Hono, and citty (CLI framework).

## Commands

- **Build:** `bun run build` (tsdown bundler, outputs to `dist/`)
- **Dev:** `bun run dev` (watch mode via `bun run --watch`)
- **Start:** `bun run start` (production mode)
- **Lint:** `bun run lint` (ESLint with `@echristian/eslint-config`)
- **Typecheck:** `bun run typecheck` (tsc, no emit)
- **Test all:** `bun test`
- **Test single file:** `bun test tests/<filename>.test.ts`
- **Unused code detection:** `bun run knip`

## Architecture

### CLI Layer (`src/main.ts`)
Entry point uses citty to define subcommands: `start`, `auth`, `check-usage`, `debug`, `console`.

### Server (`src/server.ts`)
Hono app with routes mounted at both `/` and `/v1/` prefixes for compatibility:
- `POST /v1/chat/completions` — OpenAI-compatible chat completions
- `POST /v1/messages` — Anthropic-compatible messages API
- `POST /v1/messages/count_tokens` — Token counting
- `GET /v1/models` — Model listing
- `POST /v1/embeddings` — Embeddings
- `GET /usage`, `GET /token` — Monitoring endpoints

### Key Directories
- `src/routes/` — Route handlers, each in its own directory with `route.ts` + `handler.ts`
- `src/services/copilot/` — GitHub Copilot API calls (completions, embeddings, models)
- `src/services/github/` — GitHub API calls (auth, tokens, usage)
- `src/lib/` — Shared utilities (state, tokens, rate limiting, error handling, proxy)
- `src/console/` — Multi-account management mode with load balancing and web UI
- `web/` — React + Vite frontend for the console mode
- `tests/` — Bun test runner, files named `*.test.ts`

### Global State (`src/lib/state.ts`)
Mutable singleton `state` object holds runtime config: GitHub/Copilot tokens, account type, cached models, rate limit settings.

### Anthropic Translation Layer (`src/routes/messages/`)
Converts between Anthropic message format and Copilot's OpenAI-style API. Handles both streaming (`stream-translation.ts`) and non-streaming (`non-stream-translation.ts`) responses.

## Code Conventions

- ESM only, strict TypeScript — no `any`, no unused variables/imports
- Path alias: `~/*` maps to `src/*` (e.g., `import { state } from "~/lib/state"`)
- camelCase for variables/functions, PascalCase for types/classes
- Zod v4 for runtime validation
- Pre-commit hook runs lint-staged via simple-git-hooks