#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { ensurePaths } from "./lib/paths"
import { PATHS } from "./lib/paths"
import { setupGitHubToken } from "./lib/token"

interface RunAuthOptions {
  verbose: boolean
}

export async function runAuth(options: RunAuthOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
  }

  await ensurePaths()
  await setupGitHubToken({ force: true })
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
  },
  run({ args }) {
    return runAuth({
      verbose: args.verbose,
    })
  },
})
