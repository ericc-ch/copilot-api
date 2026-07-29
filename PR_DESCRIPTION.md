# Add `models` command, formalize `/responses` support, harden defaults

This branch is **9 commits ahead of `master`**. It adds a non-interactive
`models` command, formalizes and hardens the `/responses` adapter the chat
handler already depended on, makes the server local-only by default, and fixes
documentation, Docker, and CI drift.

## Summary of changes

### Features

- **`models` CLI command** (`e273b3f`) — inspect the current Copilot models and
  their supported endpoints without starting the server. Useful for
  non-interactive deployments. Supports `--json`, `--github-token`,
  `--account-type`, `--show-token`, and `--proxy-env`.
- **`/responses` endpoint routing** (`fb77680`) — models that only advertise
  `/responses` (and not `/chat/completions`) are now transparently routed
  through a Responses API adapter that converts both non-streaming and streaming
  responses back into Chat Completions shape.
- **Tool calls over `/responses`** (`a695374`) — chat-completions tools and
  `tool_choice` are mapped into the Responses API shape, assistant `tool_calls`
  and tool results become `function_call`/`function_call_output` input items, and
  `function_call` outputs and `function_call_arguments` deltas are translated
  back into `tool_calls` (non-streaming and streaming). Replaces the earlier
  drop-with-warning behavior.
- **Local-only by default** (`44c74c7`) — the server now binds to `127.0.0.1`
  unless `--host` is passed, so it is not reachable from other machines out of
  the box. A warning prints when binding to a non-local host. The Docker
  entrypoint passes `--host 0.0.0.0` so published ports keep working.

### Fixes

- **Lazy VS Code version fetch** (`3d24eef`) — the VS Code version is now fetched
  only when called, not as an import-time network side effect.
- **Tolerate invalid tool-call JSON** (`dec3694`) — malformed tool arguments from
  Copilot no longer crash `translateToAnthropic`; the tool input falls back to
  an empty object.
- **Harden `/responses` stream adapter** (`e8f316c`) — malformed or non-JSON SSE
  events (e.g. keepalives) are skipped instead of killing the stream, and a
  warning is logged when tool definitions/calls are dropped for
  `/responses`-only models.

### Tests

- **Anthropic edge cases** (`dec3694`) — images, `tool_result` ordering
  (including multiple results per message), mixed text/tool streaming block
  transitions, invalid tool JSON, and cache-token accounting.
- **`/responses` adapter** (`fb77680`, `e8f316c`) — endpoint selection,
  non-streaming conversion, streaming event conversion, malformed-event
  skipping, and unknown-event handling.
- **`count_tokens` handler** (`ddede24`) — drives the real Hono route and locks
  the claude (1.15) and grok (1.03) multipliers, the 346/480-token tool
  overhead, the `mcp__`/`claude-code` beta exemption, and the invalid-JSON
  fallback.

### Docs / chore

- **Non-root Docker** (`58249ba`) — `Dockerfile` runs as `USER bun`; README
  volume path corrected to `/home/bun/.local/share/copilot-api`.
- **Docs drift** — `AGENTS.md` updated (`tsup` → `tsdown`, corrected test
  command); README documents the `models` command, the `--host` flag, and
  single-account/local-use assumptions.
- **GitHub Pages workflow** — now deploys from `master` (the branch this fork and
  upstream actually expose).

## Verification

- `bun run lint:all` — passing
- `bun run typecheck` — passing
- `bun test` — **60 passing** (was 29)
- `bun run build` — passing

## Notes for the maintainer

- The `/responses` adapter now forwards function tool calls, but image content
  is still stringified (`[image: <url>]`) rather than sent as a structured
  input-image part. The tool mapping was implemented against the documented
  OpenAI Responses API shapes; it should be validated against a live
  `/responses`-only Copilot model, since Copilot's variant may differ in field
  names (e.g. `call_id` vs `id`).
- Docker bind-mount permissions: under `USER bun`, the host directory mounted at
  `/home/bun/.local/share/copilot-api` must be writable by uid 1000. If you hit
  an `EACCES` on first run, `chown 1000:1000 ./copilot-data` on the host.
