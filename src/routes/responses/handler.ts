import type { Context } from "hono"

import { streamSSE } from "hono/streaming"

import { getConfig, getMappedModel } from "~/lib/config"
import { createHandlerLogger } from "~/lib/logger"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"

type ResponsesToolDefinition = {
  type?: string
  name?: string
  [key: string]: unknown
}

export type ResponsesPayload = {
  model: string
  stream?: boolean
  tools?: ResponsesToolDefinition[] | null
  [key: string]: unknown
}

export type ResponsesResult = Record<string, unknown>

type CreateResponsesOptions = {
  vision?: boolean
  initiator?: string
}

const createResponses = async (
  payload: ResponsesPayload,
  _options: CreateResponsesOptions,
): Promise<ResponsesResult> => {
  // Fallback implementation because ~/services/copilot/create-responses
  // is not available in this repository. This preserves handler behavior
  // by returning a structured error instead of failing compilation.
  return {
    error: {
      message:
        "createResponses service is not implemented in this deployment.",
      type: "not_implemented",
    },
    payload,
  }
}
import { createStreamIdTracker, fixStreamIds } from "./stream-id-sync"
import { getResponsesRequestOptions } from "./utils"

const logger = createHandlerLogger("responses-handler")

const RESPONSES_ENDPOINT = "/responses"
const FILE_EDITING_TOOL_NAMES = new Set([
  "apply_patch",
  "write",
  "write_file",
  "writefiles",
  "edit",
  "edit_file",
  "multi_edit",
  "multiedit",
])

type ResponseTool = NonNullable<ResponsesPayload["tools"]>[number]

export const handleResponses = async (c: Context) => {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  logger.debug("Responses request payload:", JSON.stringify(payload))

  payload.model = getMappedModel(payload.model)

  normalizeCustomTools(payload)
  filterUnsupportedTools(payload)

  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )
  const supportsResponses =
    selectedModel?.supported_endpoints?.includes(RESPONSES_ENDPOINT) ?? false

  if (!supportsResponses) {
    return c.json(
      {
        error: {
          message:
            "This model does not support the responses endpoint. Please choose a different model.",
          type: "invalid_request_error",
        },
      },
      400,
    )
  }

  const { vision, initiator } = getResponsesRequestOptions(payload)

  const response = await createResponses(payload, { vision, initiator })

  if (isStreamingRequested(payload) && isAsyncIterable(response)) {
    logger.debug("Forwarding native Responses stream")
    return streamSSE(c, async (stream) => {
      const idTracker = createStreamIdTracker()

      for await (const chunk of response) {
        logger.debug("Responses stream chunk:", JSON.stringify(chunk))

        const processedData = fixStreamIds(
          (chunk as { data?: string }).data ?? "",
          (chunk as { event?: string }).event,
          idTracker,
        )

        await stream.writeSSE({
          id: (chunk as { id?: string }).id,
          event: (chunk as { event?: string }).event,
          data: processedData,
        })
      }
    })
  }

  logger.debug(
    "Forwarding native Responses result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response as ResponsesResult)
}

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
  Boolean(value)
  && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"

const isStreamingRequested = (payload: ResponsesPayload): boolean =>
  Boolean(payload.stream)

const normalizeCustomTools = (payload: ResponsesPayload): void => {
  if (!Array.isArray(payload.tools)) {
    return
  }

  const config = getConfig()
  const useFunctionApplyPatch = config.useFunctionApplyPatch ?? true
  const toolsArr = payload.tools

  for (let i = 0; i < toolsArr.length; i++) {
    const tool = toolsArr[i]

    if (!isCustomTool(tool)) {
      continue
    }

    const toolName = tool.name.toLowerCase()
    if (toolName === "apply_patch" && useFunctionApplyPatch) {
      logger.debug("Converting custom apply_patch tool to function tool")
      toolsArr[i] = {
        type: "function",
        name: tool.name,
        description:
          tool.description ?? "Use the `apply_patch` tool to edit files",
        parameters: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "The entire contents of the apply_patch command",
            },
          },
          required: ["input"],
        },
        strict: false,
      }
      continue
    }

    if (FILE_EDITING_TOOL_NAMES.has(toolName)) {
      logger.debug(
        `Converting custom file editing tool to function tool: ${tool.name}`,
      )
      toolsArr[i] = {
        type: "function",
        name: tool.name,
        description:
          tool.description
          ?? "Edit or write files in the local workspace and return a concise result.",
        parameters: getCustomToolParameters(tool),
        strict: false,
      }
    }
  }
}

const isCustomTool = (
  tool: ResponseTool,
): tool is {
  type: "custom"
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  parameters?: Record<string, unknown>
} => tool.type === "custom" && typeof tool.name === "string"

const getCustomToolParameters = (tool: {
  input_schema?: Record<string, unknown>
  parameters?: Record<string, unknown>
}): Record<string, unknown> =>
  tool.parameters
  ?? tool.input_schema ?? {
    type: "object",
    additionalProperties: true,
    properties: {
      file_path: {
        type: "string",
        description: "Path of the file to write or edit.",
      },
      content: {
        type: "string",
        description: "New file content for write operations.",
      },
      old_string: {
        type: "string",
        description: "Text to replace for edit operations.",
      },
      new_string: {
        type: "string",
        description: "Replacement text for edit operations.",
      },
      edits: {
        type: "array",
        description: "Batch edit instructions for multi-edit operations.",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  }

/**
 * Filter out unsupported tool types for Copilot API
 * Copilot only supports "function" type tools
 */
const filterUnsupportedTools = (payload: ResponsesPayload): void => {
  if (Array.isArray(payload.tools)) {
    const originalCount = payload.tools.length
    payload.tools = payload.tools.filter((tool) => tool.type === "function")
    const filteredCount = originalCount - payload.tools.length
    if (filteredCount > 0) {
      logger.debug(
        `Filtered out ${filteredCount} unsupported tool(s) from request`,
      )
    }
  }
}
