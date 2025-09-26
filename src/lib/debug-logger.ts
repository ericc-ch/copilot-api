import { existsSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { GeminiRequest } from "~/routes/generate-content/types"
import type {
  ChatCompletionsPayload,
  ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

interface DebugLogData {
  timestamp: string
  requestId: string
  originalGeminiPayload: GeminiRequest
  translatedOpenAIPayload: ChatCompletionsPayload | null
  error?: string
  processingTime?: number
}

export class DebugLogger {
  private static instance: DebugLogger | undefined
  private logDir: string

  private constructor() {
    this.logDir = process.env.DEBUG_LOG_DIR || join(process.cwd(), "debug-logs")
    this.ensureLogDir()
  }

  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger()
    }
    return DebugLogger.instance
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private generateLogFileName(requestId: string): string {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    return join(this.logDir, `debug-gemini-${timestamp}-${requestId}.log`)
  }

  async logRequest(data: {
    requestId: string
    geminiPayload: GeminiRequest
    openAIPayload?: ChatCompletionsPayload | null
    error?: string
    processingTime?: number
  }): Promise<void> {
    const logData: DebugLogData = {
      timestamp: new Date().toISOString(),
      requestId: data.requestId,
      originalGeminiPayload: data.geminiPayload,
      translatedOpenAIPayload: data.openAIPayload ?? null,
      error: data.error,
      processingTime: data.processingTime,
    }

    const logPath = this.generateLogFileName(data.requestId)

    try {
      await writeFile(logPath, JSON.stringify(logData, null, 2), "utf8")
      console.log(`[DEBUG] Logged request data to: ${logPath}`)
    } catch (writeError) {
      console.error(`[DEBUG] Failed to write log file ${logPath}:`, writeError)
    }
  }

  // For backward compatibility during development
  static async logGeminiRequest(
    geminiPayload: GeminiRequest,
    openAIPayload?: ChatCompletionsPayload,
    error?: string,
  ): Promise<void> {
    const logger = DebugLogger.getInstance()
    const requestId = Math.random().toString(36).slice(2, 8)
    await logger.logRequest({ requestId, geminiPayload, openAIPayload, error })
  }

  // Log GitHub Copilot API Response
  static async logCopilotResponse(
    response: ChatCompletionResponse,
    context?: string,
  ): Promise<void> {
    const logger = DebugLogger.getInstance()
    const requestId = Math.random().toString(36).slice(2, 8)
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    const logPath = join(
      logger.logDir,
      `debug-copilot-response-${timestamp}-${requestId}.log`,
    )

    const logData = {
      timestamp: new Date().toISOString(),
      context: context || "GitHub Copilot API Response",
      response,
    }

    try {
      await writeFile(logPath, JSON.stringify(logData, null, 2), "utf8")
      console.log(`[DEBUG] Logged Copilot response to: ${logPath}`)
    } catch (writeError) {
      console.error(
        `[DEBUG] Failed to write Copilot response log file ${logPath}:`,
        writeError,
      )
    }
  }

  // Log any object for debugging purposes
  static async logDebugData(
    data: unknown,
    context: string,
    filePrefix = "debug-data",
  ): Promise<void> {
    const logger = DebugLogger.getInstance()
    const requestId = Math.random().toString(36).slice(2, 8)
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    const logPath = join(
      logger.logDir,
      `${filePrefix}-${timestamp}-${requestId}.log`,
    )

    const logData = {
      timestamp: new Date().toISOString(),
      context,
      data,
    }

    try {
      await writeFile(logPath, JSON.stringify(logData, null, 2), "utf8")
      console.log(`[DEBUG] Logged ${context} to: ${logPath}`)
    } catch (writeError) {
      console.error(
        `[DEBUG] Failed to write debug log file ${logPath}:`,
        writeError,
      )
    }
  }

  // Log original and translated response comparison
  static async logResponseComparison(
    originalResponse: unknown,
    translatedResponse: unknown,
    options: { context: string; filePrefix?: string } = {
      context: "Response Comparison",
    },
  ): Promise<void> {
    const { context, filePrefix = "debug-comparison" } = options
    const logger = DebugLogger.getInstance()
    const requestId = Math.random().toString(36).slice(2, 8)
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    const logPath = join(
      logger.logDir,
      `${filePrefix}-${timestamp}-${requestId}.log`,
    )

    const logData = {
      timestamp: new Date().toISOString(),
      context,
      originalResponse,
      translatedResponse,
    }

    try {
      await writeFile(logPath, JSON.stringify(logData, null, 2), "utf8")
      console.log(`[DEBUG] Logged ${context} comparison to: ${logPath}`)
    } catch (writeError) {
      console.error(
        `[DEBUG] Failed to write comparison log file ${logPath}:`,
        writeError,
      )
    }
  }
}
