import type {
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"
import type { Model } from "~/services/copilot/get-models"

// Encoder type mapping
const ENCODING_MAP = {
  o200k_base: () => import("gpt-tokenizer/encoding/o200k_base"),
  cl100k_base: () => import("gpt-tokenizer/encoding/cl100k_base"),
  p50k_base: () => import("gpt-tokenizer/encoding/p50k_base"),
  p50k_edit: () => import("gpt-tokenizer/encoding/p50k_edit"),
  r50k_base: () => import("gpt-tokenizer/encoding/r50k_base"),
} as const

type SupportedEncoding = keyof typeof ENCODING_MAP

// Define encoder interface
interface Encoder {
  encode: (text: string) => Array<number>
}

// Cache loaded encoders to avoid repeated imports
const encodingCache = new Map<string, Encoder>()

/**
 * Calculate tokens for tool calls
 */
const calculateToolCallsTokens = (
  toolCalls: Array<ToolCall>,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  let tokens = 0
  for (const toolCall of toolCalls) {
    tokens += constants.funcInit
    tokens += encoder.encode(JSON.stringify(toolCall)).length
  }
  tokens += constants.funcEnd
  return tokens
}

/**
 * Calculate tokens for content parts
 */
const calculateContentPartsTokens = (
  contentParts: Array<ContentPart>,
  encoder: Encoder,
): number => {
  let tokens = 0
  for (const part of contentParts) {
    if (part.type === "image_url") {
      tokens += encoder.encode(part.image_url.url).length + 85
    } else if (part.text) {
      tokens += encoder.encode(part.text).length
    }
  }
  return tokens
}

/**
 * Calculate tokens for a single message
 */
const calculateMessageTokens = (
  message: Message,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  const tokensPerMessage = 3
  const tokensPerName = 1
  let tokens = tokensPerMessage
  for (const [key, value] of Object.entries(message)) {
    if (typeof value === "string") {
      tokens += encoder.encode(value).length
    }
    if (key === "name") {
      tokens += tokensPerName
    }
    if (key === "tool_calls") {
      tokens += calculateToolCallsTokens(
        value as Array<ToolCall>,
        encoder,
        constants,
      )
    }
    if (key === "content" && Array.isArray(value)) {
      tokens += calculateContentPartsTokens(
        value as Array<ContentPart>,
        encoder,
      )
    }
  }
  return tokens
}

/**
 * Calculate tokens using custom algorithm
 */
const calculateTokens = (
  messages: Array<Message>,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  if (messages.length === 0) {
    return 0
  }
  let numTokens = 0
  for (const message of messages) {
    numTokens += calculateMessageTokens(message, encoder, constants)
  }
  // every reply is primed with <|start|>assistant<|message|>
  numTokens += 3
  return numTokens
}

/**
 * Get the corresponding encoder module based on encoding type
 */
const getEncodeChatFunction = async (encoding: string): Promise<Encoder> => {
  if (encodingCache.has(encoding)) {
    const cached = encodingCache.get(encoding)
    if (cached) {
      return cached
    }
  }

  const supportedEncoding = encoding as SupportedEncoding
  if (!(supportedEncoding in ENCODING_MAP)) {
    const fallbackModule = (await ENCODING_MAP.o200k_base()) as Encoder
    encodingCache.set(encoding, fallbackModule)
    return fallbackModule
  }

  const encodingModule = (await ENCODING_MAP[supportedEncoding]()) as Encoder
  encodingCache.set(encoding, encodingModule)
  return encodingModule
}

/**
 * Get tokenizer type from model information
 */
export const getTokenizerFromModel = (model: Model): string => {
  return model.capabilities.tokenizer || "o200k_base"
}

/**
 * Get model-specific constants for token calculation
 */
const getModelConstants = (model: Model) => {
  return model.id === "gpt-3.5-turbo" || model.id === "gpt-4" ?
      {
        funcInit: 10,
        propInit: 3,
        propKey: 3,
        enumInit: -3,
        enumItem: 3,
        funcEnd: 12,
      }
    : {
        funcInit: 7,
        propInit: 3,
        propKey: 3,
        enumInit: -3,
        enumItem: 3,
        funcEnd: 12,
      }
}

/**
 * Calculate tokens for a single parameter
 */
const calculateParameterTokens = (
  key: string,
  prop: unknown,
  context: {
    encoder: Encoder
    constants: ReturnType<typeof getModelConstants>
  },
): number => {
  const { encoder, constants } = context
  let tokens = constants.propKey

  // Early return if prop is not an object
  if (typeof prop !== "object" || prop === null) {
    return tokens
  }

  // Type assertion for parameter properties
  const param = prop as {
    type?: string
    description?: string
    enum?: Array<unknown>
    [key: string]: unknown
  }

  const paramName = key
  const paramType = param.type || "string"
  let paramDesc = param.description || ""

  // Handle enum values
  if (param.enum && Array.isArray(param.enum)) {
    tokens += constants.enumInit
    for (const item of param.enum) {
      tokens += constants.enumItem
      tokens += encoder.encode(String(item)).length
    }
  }

  // Clean up description
  if (paramDesc.endsWith(".")) {
    paramDesc = paramDesc.slice(0, -1)
  }

  // Encode the main parameter line
  const line = `${paramName}:${paramType}:${paramDesc}`
  tokens += encoder.encode(line).length

  // Handle additional properties (excluding standard ones)
  const excludedKeys = new Set(["type", "description", "enum"])
  for (const propertyName of Object.keys(param)) {
    if (!excludedKeys.has(propertyName)) {
      const propertyValue = param[propertyName]
      const propertyText =
        typeof propertyValue === "string" ? propertyValue : (
          JSON.stringify(propertyValue)
        )
      tokens += encoder.encode(`${propertyName}:${propertyText}`).length
    }
  }

  return tokens
}

/**
 * Calculate tokens for function parameters
 */
const calculateParametersTokens = (
  parameters: unknown,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  if (!parameters || typeof parameters !== "object") {
    return 0
  }

  const params = parameters as Record<string, unknown>
  let tokens = 0

  for (const [key, value] of Object.entries(params)) {
    if (key === "properties") {
      const properties = value as Record<string, unknown>
      if (Object.keys(properties).length > 0) {
        tokens += constants.propInit
        for (const propKey of Object.keys(properties)) {
          tokens += calculateParameterTokens(propKey, properties[propKey], {
            encoder,
            constants,
          })
        }
      }
    } else {
      const paramText =
        typeof value === "string" ? value : JSON.stringify(value)
      tokens += encoder.encode(`${key}:${paramText}`).length
    }
  }

  return tokens
}

/**
 * Calculate tokens for a single tool
 */
const calculateToolTokens = (
  tool: Tool,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  let tokens = constants.funcInit
  const func = tool.function
  const fName = func.name
  let fDesc = func.description || ""
  if (fDesc.endsWith(".")) {
    fDesc = fDesc.slice(0, -1)
  }
  const line = fName + ":" + fDesc
  tokens += encoder.encode(line).length
  if (
    typeof func.parameters === "object" // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    && func.parameters !== null
  ) {
    tokens += calculateParametersTokens(func.parameters, encoder, constants)
  }
  return tokens
}

/**
 * Calculate token count for tools based on model
 */
export const numTokensForTools = (
  tools: Array<Tool>,
  encoder: Encoder,
  constants: ReturnType<typeof getModelConstants>,
): number => {
  let funcTokenCount = 0
  for (const tool of tools) {
    funcTokenCount += calculateToolTokens(tool, encoder, constants)
  }
  funcTokenCount += constants.funcEnd
  return funcTokenCount
}

/**
 * Calculate the token count of messages, supporting multiple GPT encoders
 */
export const getTokenCount = async (
  payload: ChatCompletionsPayload,
  model: Model,
): Promise<{ input: number; output: number }> => {
  // Get tokenizer string
  const tokenizer = getTokenizerFromModel(model)

  // Get corresponding encoder module
  const encoder = await getEncodeChatFunction(tokenizer)

  const simplifiedMessages = payload.messages
  const inputMessages = simplifiedMessages.filter(
    (msg) => msg.role !== "assistant",
  )
  const outputMessages = simplifiedMessages.filter(
    (msg) => msg.role === "assistant",
  )

  const constants = getModelConstants(model)
  let inputTokens = calculateTokens(inputMessages, encoder, constants)
  if (payload.tools && payload.tools.length > 0) {
    inputTokens += numTokensForTools(payload.tools, encoder, constants)
  }
  const outputTokens = calculateTokens(outputMessages, encoder, constants)

  return {
    input: inputTokens,
    output: outputTokens,
  }
}
