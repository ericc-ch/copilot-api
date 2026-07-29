#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { state } from "./lib/state"
import { setupGitHubToken } from "./lib/token"
import { cacheVSCodeVersion } from "./lib/utils"
import { getModels } from "./services/copilot/get-models"
import { getCopilotToken } from "./services/github/get-copilot-token"

interface RunModelsOptions {
  verbose: boolean
  accountType: string
  githubToken?: string
  showToken: boolean
  proxyEnv: boolean
  json: boolean
}

export async function runModels(options: RunModelsOptions): Promise<void> {
  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  state.showToken = options.showToken

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    await setupGitHubToken()
  }

  const { token } = await getCopilotToken()
  state.copilotToken = token

  if (state.showToken) {
    consola.info("Copilot token:", token)
  }

  const models = await getModels()

  if (options.json) {
    console.log(JSON.stringify(models, null, 2))
    return
  }

  consola.box(
    models.data
      .map((model) => {
        const endpoints = model.supported_endpoints?.join(", ") ?? "default"
        return `${model.id} (${model.vendor}; ${endpoints})`
      })
      .join("\n"),
  )
}

export const models = defineCommand({
  meta: {
    name: "models",
    description: "List the current GitHub Copilot models available to the API",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Output raw model response as JSON",
    },
  },
  run({ args }) {
    return runModels({
      verbose: args.verbose,
      accountType: args["account-type"],
      githubToken: args["github-token"],
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      json: args.json,
    })
  },
})
