import consola from "consola"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

interface ClaudeSettingsFile {
  env?: Record<string, unknown>
}

const getClaudeSettingsPaths = (): Array<string> => {
  const currentWorkingDirectory = process.cwd()
  const homeDirectory = process.env.HOME ?? os.homedir()

  return [
    path.join(homeDirectory, ".claude", "settings.json"),
    path.join(currentWorkingDirectory, ".claude", "settings.json"),
    path.join(currentWorkingDirectory, ".claude", "settings.local.json"),
  ]
}

const readClaudeSettingsFile = async (
  filePath: string,
): Promise<ClaudeSettingsFile | undefined> => {
  try {
    const content = await fs.readFile(filePath)
    return JSON.parse(content) as ClaudeSettingsFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }

    consola.warn(`Failed to read Claude settings from ${filePath}:`, error)
    return undefined
  }
}

export const getClaudeSettingsEnv = async (): Promise<
  Record<string, string>
> => {
  const mergedEnv: Record<string, string> = {}

  for (const filePath of getClaudeSettingsPaths()) {
    const settings = await readClaudeSettingsFile(filePath)
    if (!settings?.env) {
      continue
    }

    for (const [key, value] of Object.entries(settings.env)) {
      if (typeof value === "string") {
        mergedEnv[key] = value
      }
    }
  }

  return mergedEnv
}
