#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import { Agent, setGlobalDispatcher } from "undici"

import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { debug } from "./debug"
import { start } from "./start"

// Extend undici global timeouts to tolerate long GitHub Copilot upstream responses
// (subagent workloads routinely exceed default 300s headersTimeout).
setGlobalDispatcher(
  new Agent({
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
    keepAliveTimeout: 120_000,
    keepAliveMaxTimeout: 600_000,
    connect: { timeout: 30_000 },
  }),
)

const main = defineCommand({
  meta: {
    name: "copilot-api",
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: { auth, start, "check-usage": checkUsage, debug },
})

await runMain(main)
