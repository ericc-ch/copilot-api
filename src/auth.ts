#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { PATHS, ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { setupGitHubToken } from "./lib/token"

interface RunAuthOptions {
  verbose: boolean
  showToken: boolean
  githubUrl?: string
}

export async function runAuth(options: RunAuthOptions): Promise<void> {
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.showToken = options.showToken

  const githubUrl = options.githubUrl ?? process.env.GITHUB_URL
  if (githubUrl) {
    state.githubUrl = githubUrl
    consola.info(`Using GitHub Enterprise URL: ${githubUrl}`)
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
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub token on auth",
    },
    "github-url": {
      type: "string",
      description:
        "GitHub Enterprise URL (e.g., https://github.example.com). Can also be set via GITHUB_URL env var",
    },
  },
  run({ args }) {
    return runAuth({
      verbose: args.verbose,
      showToken: args["show-token"],
      githubUrl: args["github-url"],
    })
  },
})
