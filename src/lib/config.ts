import consola from "consola"
import fs from "node:fs"

import { PATHS } from "./paths"

export interface AppConfig {
  extraPrompts?: Record<string, string>
}

const defaultConfig: AppConfig = {
  extraPrompts: {
    "gpt-5-codex": `
## Tool use
- You have access to many tools. If a tool exists to perform a specific task, you MUST use that tool instead of running a terminal command to perform that task.
### Bash tool
When using the Bash tool, follow these rules:
- always run_in_background set to false, unless you are running a long-running command (e.g., a server or a watch command).
### BashOutput tool
When using the BashOutput tool, follow these rules:
- Only Bash Tool run_in_background set to true, Use BashOutput to read the output later
### TodoWrite tool
When using the TodoWrite tool, follow these rules:
- Skip using the TodoWrite tool for tasks with three or fewer steps.
- Do not make single-step todo lists.
- When you made a todo, update it after having performed one of the sub-tasks that you shared on the todo list.
## Special user requests
- If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal command (such as 'date'), you should do so.
`,
  },
}

let cachedConfig: AppConfig | null = null

function ensureConfigFile(): void {
  try {
    fs.accessSync(PATHS.CONFIG_PATH, fs.constants.R_OK | fs.constants.W_OK)
  } catch {
    fs.writeFileSync(
      PATHS.CONFIG_PATH,
      `${JSON.stringify(defaultConfig, null, 2)}\n`,
      "utf8",
    )
    try {
      fs.chmodSync(PATHS.CONFIG_PATH, 0o600)
    } catch {
      return
    }
  }
}

function readConfigFromDisk(): AppConfig {
  ensureConfigFile()
  try {
    const raw = fs.readFileSync(PATHS.CONFIG_PATH, "utf8")
    if (!raw.trim()) {
      fs.writeFileSync(
        PATHS.CONFIG_PATH,
        `${JSON.stringify(defaultConfig, null, 2)}\n`,
        "utf8",
      )
      return defaultConfig
    }
    return JSON.parse(raw) as AppConfig
  } catch (error) {
    consola.error("Failed to read config file, using default config", error)
    return defaultConfig
  }
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = readConfigFromDisk()
  }
  return cachedConfig
}

export function getExtraPromptForModel(model: string): string {
  const config = getConfig()
  return config.extraPrompts?.[model] ?? ""
}
