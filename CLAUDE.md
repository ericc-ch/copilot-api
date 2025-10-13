# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Overview

- Purpose: This repository implements a reverse-engineered proxy that exposes GitHub Copilot as OpenAI- and Anthropic-compatible APIs. It is a CLI application written in TypeScript that targets Bun as the runtime and ships a compiled dist/ binary.
- Language/runtime: TypeScript targeting bun/node (project uses "type": "module" and bun tooling).

Key developer commands

- Install dependencies (Bun):
  - bun install

- Build (compile TS -> dist):
  - bun run build
  - Equivalent: tsdown (invoked by npm script "build")

- Run in development (watch):
  - bun run dev

- Run production start (local):
  - bun run start
  - Or: NODE_ENV=production bun run ./src/main.ts

- Linting:
  - bun run lint
  - Full lint: bun run lint:all

- Type check:
  - bun run typecheck

- Packaging / release:
  - bun run release

- Running a single command from the CLI (examples):
  - npx copilot-api@latest start --port 8080 --verbose
  - npx copilot-api@latest auth

High-level architecture

- Entry points
  - src/main.ts: defines the CLI and wires subcommands (auth, start, check-usage, debug). See src/main.ts:10
  - src/start.ts: CLI implementation for the start subcommand, orchestrates initialization and launches the HTTP server. See src/start.ts:30

- Server and routes
  - src/server.ts: central HTTP server handler and route registration. See src/server.ts:1
  - Routes folder: src/routes/ contains OpenAI and Anthropic-compatible route implementations:
    - src/routes/chat-completions/*: chat completions compatibility
    - src/routes/embeddings/*: embedding endpoint
    - src/routes/messages/*: Anthropic-compatible messages endpoints
    - src/routes/models/route.ts: lists available models
    - src/routes/token/route.ts and src/routes/usage/route.ts: token and usage endpoints

- Copilot and GitHub integration
  - src/services/github/: contains GitHub auth/device flow and token/capacity checks
  - src/services/copilot/: interacts with Copilot endpoints (models, chat completions, embeddings)

- Internal libraries
  - src/lib/: utility modules and internal state management
    - paths.ts: application file paths and persistence (src/lib/paths.ts:5)
    - token.ts: copilot/token setup and persistence
    - api-config.ts, proxy.ts, rate-limit.ts, tokenizer.ts, utils.ts
    - state.ts: in-memory runtime state

- CLI UX and tooling
  - Uses citty for argument parsing (see src/main.ts:3)
  - Uses srvx to serve the HTTP server (start.run -> serve in src/start.ts:117)
  - Uses bun-specific tooling in package.json scripts (bun run, tsdown, etc.)

Important notes for Claude Code instances

- Preferred tooling: Use Bun commands (bun install, bun run dev/start/build). Many scripts assume Bun is installed.
- Local dev: Use "bun run dev" to iterate with file watching; use "bun run start" for a production-like run.
- Authentication: The application persists GitHub tokens under ~/.local/share/copilot-api (see src/lib/paths.ts:5-12). Avoid exposing tokens in commits or logs.
- GitHub Enterprise support: Use --enterprise-url flags for GitHub Enterprise Server/Cloud. The CLI will prompt interactively during auth if no enterprise URL is provided. Enterprise host is persisted for subsequent runs.
- Enterprise URLs: Stored in APP_DIR/enterprise_url and normalized (scheme/slash stripped) before persistence. OAuth flows use https://{enterprise} endpoints, Copilot API uses https://copilot-api.{enterprise} for models and chat endpoints, and https://api.{enterprise} for token/usage endpoints.
- Rate limiting & manual approval: These behaviours are controlled in start.ts and state.ts; tests or changes touching rate limiting should check src/lib/rate-limit.ts.

Files and areas to inspect for common tasks

- To change CLI flags or behavior: src/start.ts:123 and src/main.ts:10
- To modify route behavior: src/server.ts and files in src/routes/ (chat-completions, embeddings, messages)
- To adjust model fetching or caching: src/services/copilot/get-models.ts and src/lib/utils.ts

Copying README.md highlights

- The project README contains extra usage examples (Docker, npx, Claude Code integration) that are useful to surface to users. See README.md for usage and environment variables.

Notes omitted

- This file intentionally avoids repeating trivial development rules or generic style guidance.

