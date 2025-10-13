# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

TypeScript CLI application using Bun runtime that exposes GitHub Copilot as OpenAI/Anthropic-compatible APIs.

## Commands

- `bun install` - Install dependencies
- `bun run build` - Build distribution
- `bun run dev` - Development with watch mode
- `bun run start` - Production start
- `bun run lint` - Lint code
- `bun run typecheck` - Type checking
- `bun test` - Run tests

## Architecture

- **Entry**: `src/main.ts` - CLI definition with subcommands (auth, start, check-usage, debug)
- **Server**: `src/start.ts` - Orchestrates initialization and HTTP server
- **Routes**: `src/routes/` - OpenAI & Anthropic compatible endpoints
- **Services**:
  - `src/services/github/` - GitHub OAuth and token management
  - `src/services/copilot/` - Copilot API interactions
- **Utilities**: `src/lib/` - State management, paths, token handling

## GitHub Enterprise Support

- Use `--enterprise-url` flag for GHE Server/Cloud
- Interactive prompt during auth if no flag provided
- Enterprise URL persisted in `~/.local/share/copilot-api/enterprise_url`
- Endpoints: `https://{enterprise}/...` for OAuth, `https://api.{enterprise}/...` for GitHub API, `https://copilot-api.{enterprise}/...` for Copilot

## Key Files

- CLI flags: `src/start.ts:123`, `src/main.ts:10`
- Routes: `src/server.ts`, `src/routes/*`
- Models: `src/services/copilot/get-models.ts`
- Token storage: `src/lib/paths.ts`, `src/lib/token.ts`
