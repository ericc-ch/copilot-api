#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { auth } from "./auth"
import { cacheModels } from "./lib/models"
import { ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheVSCodeVersion } from "./lib/vscode-version"
import { server } from "./server"

interface RunServerOptions {
  port: number
  verbose: boolean
  business: boolean
  enterprise: boolean
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
}

export async function runServer(options: RunServerOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }

  if (options.business) {
    state.accountType = "business"
  } else if (options.enterprise) {
    state.accountType = "enterprise"
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
  } else {
    await setupGitHubToken()
  }

  await setupCopilotToken()
  await cacheModels()

  const serverUrl = `http://localhost:${options.port}`
  consola.box(`Server started at ${serverUrl}`)

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
  })
}

const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    business: {
      type: "boolean",
      default: false,
      description: "Use a business plan GitHub account",
    },
    enterprise: {
      type: "boolean",
      default: false,
      description: "Use an enterprise plan GitHub account",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    const port = Number.parseInt(args.port, 10)

    return runServer({
      port,
      verbose: args.verbose,
      business: args.business,
      enterprise: args.enterprise,
      manual: args.manual,
      rateLimit,
      rateLimitWait: Boolean(args.wait),
      githubToken: args["github-token"],
    })
  },
})

const main = defineCommand({
  meta: {
    name: "copilot-api",
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: { auth, start },
})

await runMain(main)
