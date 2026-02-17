#!/usr/bin/env node

import { defineCommand, runMain } from "citty"

import { auth } from "./auth"
import { checkUsage } from "./check-usage"
import { console_ } from "./console/index"
import { debug } from "./debug"
import { start } from "./start"

const main = defineCommand({
  meta: {
    name: "copilot-api",
    description:
      "A wrapper around GitHub Copilot API to make it OpenAI compatible, making it usable for other tools.",
  },
  subCommands: {
    auth,
    start,
    "check-usage": checkUsage,
    debug,
    console: console_,
  },
})

await runMain(main)
