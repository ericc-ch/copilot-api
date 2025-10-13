#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { PATHS, ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { setupGitHubToken } from "./lib/token"

interface RunAuthOptions {
  verbose: boolean
  showToken: boolean
  enterpriseUrl?: string
}

export async function runAuth(options: RunAuthOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.showToken = options.showToken
  await ensurePaths()

  // If no enterpriseUrl provided, ask interactively whether the user uses GH Enterprise.
  let enterprise = options.enterpriseUrl
  if (!enterprise) {
    const resp = await consola.prompt(
      "Are you using GitHub Enterprise / GitHub Enterprise Server?",
      {
        type: "confirm",
        initial: false,
      },
    )
    if (resp) {
      const hostResp = await consola.prompt(
        "Enter enterprise host (eg. ghe.example.com or https://ghe.example.com):",
        {
          type: "text",
        },
      )
      enterprise = hostResp
    }
  }

  await setupGitHubToken({
    force: true,
    ...(enterprise ? { enterpriseUrl: enterprise } : {}),
  })
  consola.success("GitHub token written to", PATHS.GITHUB_TOKEN_PATH)
}

export const auth = defineCommand({
  meta: {
    name: "auth",
    description: "Run GitHub auth flow without running the server",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub token on auth",
    },
    "enterprise-url": {
      type: "string",
      description:
        "GitHub Enterprise host (eg. https://ghe.example.com or ghe.example.com)",
    },
  },
  run({ args }) {
    return runAuth({
      verbose: args.verbose,
      showToken: args["show-token"],
      enterpriseUrl: args["enterprise-url"],
    })
  },
})
