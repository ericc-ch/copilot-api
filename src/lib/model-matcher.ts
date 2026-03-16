import consola from "consola"

import modelConsumptionData from "./model-consumption.json"
import { state } from "./state"

/**
 * 获取模型消耗值
 * 从配置文件中查询指定模型的消耗系数
 * 
 * @param modelName - 模型名称
 * @returns 消耗系数（如 1.0, 2.0 等），未找到或解析失败返回 999
 * 
 * @example
 * getModelConsumption("claude-3.5-sonnet") // 返回 1.0
 * getModelConsumption("gpt-4") // 返回 2.0
 * getModelConsumption("unknown-model") // 返回 999
 */
function getModelConsumption(modelName: string): number {
  // 将模型消耗数据转换为 Map 结构，方便快速查询
  const consumptionMap = new Map(
    modelConsumptionData.models.map((m) => [m.name, m.consumption]),
  )
  
  // 获取消耗值，未找到则返回 "N/A"
  const consumption = consumptionMap.get(modelName) || "N/A"

  // 如果模型不在配置中，返回最大值 999
  if (consumption === "N/A") return 999
  
  // 解析消耗值（格式如 "1.0x", "2.5x"）
  const match = consumption.match(/^([\d.]+)x$/)
  return match ? Number.parseFloat(match[1]) : 999
}

/**
 * 检查高级交互配额使用率是否过高（超过 50%）
 * 
 * 当高级模型使用率超过 50% 时，系统会倾向于使用 0x 消耗的模型，
 * 以避免快速耗尽配额
 * 
 * @returns true 表示使用率 >50%，false 表示使用率 ≤50% 或未初始化
 */
function isPremiumUsageHigh(): boolean {
  // 如果没有高级交互数据，认为使用率不高
  if (!state.premiumInteractions) {
    return false
  }

  // 计算已使用百分比：100% - 剩余百分比 = 已使用百分比
  const usagePercent = 100 - state.premiumInteractions.percent_remaining
  return usagePercent > 50
}

/**
 * 获取所有 0x 消耗的模型列表
 * 
 * 这些模型不计入高级交互配额，可以在配额紧张时优先使用
 * 
 * @returns 0x 消耗模型的 ID 数组
 */
function getZeroConsumptionModels(): string[] {
  // 筛选出有效的可用模型（必须有上下文窗口限制配置）
  const availableModels = state.models?.data.filter(
    (m) => typeof m.capabilities?.limits?.max_context_window_tokens === "number",
  )

  if (!availableModels) return []

  // 过滤出消耗值为 0 的模型，返回其 ID
  return availableModels
    .filter((m) => getModelConsumption(m.name) === 0)
    .map((m) => m.id)
}

/**
 * 从可用模型中查找匹配的模型
 * 
 * 匹配策略：
 * 1. 标准化匹配：标准化后的模型名称匹配（下划线转连字符、版本号格式化）
 * 2. 前缀匹配：模型名称前缀匹配
 * 3. 基础名称匹配：忽略版本号后的基础名称匹配
 * 
 * 配额保护：
 * - 当高级交互使用率 >50% 时，所有匹配仅限于 0x 消耗模型
 * - 无匹配时降级到第一个 0x 模型
 * 
 * @param requestedModel - 请求的模型标识符
 * @returns 匹配的模型 ID，未找到返回 null
 * 
 * @example
 * findMatchingModel("claude-3-5-sonnet") // 返回 "claude-3.5-sonnet"
 * findMatchingModel("gpt-4-20240101") // 返回 "gpt-4"
 */
export function findMatchingModel(requestedModel: string): string | null {
  // 获取所有有效的可用模型（必须配置了上下文窗口限制）
  const availableModels = state.models?.data.filter(
    (m) => typeof m.capabilities?.limits?.max_context_window_tokens === "number",
  )

  // 如果没有可用模型，直接返回 null
  if (!availableModels || availableModels.length === 0) {
    return null
  }

  // 检查是否处于高使用率状态
  const highUsage = isPremiumUsageHigh()
  
  // 如果使用率高，获取 0x 消耗模型列表用于限制匹配范围
  const zeroConsumptionModels = highUsage ? getZeroConsumptionModels() : []
  
  // 提取所有可用模型的 ID
  const allAvailableModelIds = availableModels.map((m) => m.id)

  consola.debug(`正在查找匹配模型：${requestedModel}`)
  consola.debug(`所有可用模型：${allAvailableModelIds.join(", ")}`)

  // ========== 配额保护：高使用率时限制模糊匹配范围 ==========
  let availableModelIds = allAvailableModelIds
  if (highUsage && zeroConsumptionModels.length > 0) {
    consola.info(
      `⚠️  高级交互使用率 >50%，模糊匹配仅限 0x 消耗模型`,
    )
    availableModelIds = zeroConsumptionModels
    consola.debug(`用于匹配的 0x 模型：${availableModelIds.join(", ")}`)
  }

  // ========== 标准化处理：统一模型名称格式 ==========
  // 1. 转换为小写
  // 2. 下划线转连字符（claude_3_5 -> claude-3-5）
  // 3. 移除日期后缀（-20251001 等 8 位数字）
  // 4. 版本号格式化（4-5 -> 4.5）
  let normalizedRequested = requestedModel
    .toLowerCase()
    .replace(/_/g, "-")                 // 下划线转连字符
    .replace(/-(\d{8})$/, "")           // 移除 -20251001 风格的日期后缀
    .replace(/(\d)-(\d)/g, "$1.$2")     // 版本号：4-5 -> 4.5

  consola.debug(`标准化后的请求模型：${normalizedRequested}`)

  // ========== 策略 1：标准化后精确匹配 ==========
  for (const availableId of availableModelIds) {
    if (availableId.toLowerCase() === normalizedRequested) {
      consola.info(
        `🔄 标准化匹配成功：'${requestedModel}' -> '${availableId}'`,
      )
      return availableId
    }
  }

  // ========== 策略 2：前缀匹配 ==========
  // 检查请求的模型和可用模型是否有前缀关系
  // 例如：claude-3.5 可以匹配 claude-3.5-sonnet-20241022
  for (const availableId of availableModelIds) {
    const normalizedAvailable = availableId.toLowerCase()

    // 双向前缀检查：请求模型是可用模型的前缀，或可用模型是请求模型的前缀
    if (
      normalizedAvailable.startsWith(normalizedRequested) ||
      normalizedRequested.startsWith(normalizedAvailable)
    ) {
      consola.info(
        `🔄 前缀匹配成功：'${requestedModel}' -> '${availableId}'`,
      )
      return availableId
    }
  }

  // ========== 策略 3：基础名称匹配（忽略版本号） ==========
  // 将模型名称按 "-" 分割，比较除最后一部分外的所有部分
  // 例如：claude-3-5-sonnet-v2 和 claude-3-5-sonnet-v1 的基础名称都是 claude-3-5-sonnet
  const requestedParts = normalizedRequested.split("-")
  for (const availableId of availableModelIds) {
    const normalizedAvailable = availableId.toLowerCase()
    const availableParts = normalizedAvailable.split("-")

    // 只对至少有 3 个部分的模型名称进行基础匹配（避免过于宽泛）
    if (requestedParts.length >= 3 && availableParts.length >= 3) {
      // 提取基础名称（去掉最后一个部分，通常是版本号或日期）
      const requestedBase = requestedParts.slice(0, -1).join("-")
      const availableBase = availableParts.slice(0, -1).join("-")

      if (requestedBase === availableBase) {
        consola.info(
          `🔄 基础名称匹配成功：'${requestedModel}' -> '${availableId}'`,
        )
        return availableId
      }
    }
  }

  // ========== 降级策略：使用率高时降级到第一个 0x 模型 ==========
  if (highUsage && zeroConsumptionModels.length > 0) {
    consola.warn(
      `⚠️  未找到匹配的 0x 模型，降级到：${zeroConsumptionModels[0]}`,
    )
    return zeroConsumptionModels[0]
  }

  // 所有策略都失败，返回 null
  consola.debug(`未找到匹配模型：${requestedModel}`)
  return null
}

/**
 * 验证并替换请求的模型
 * 
 * 该函数是模型匹配的主要入口点，负责：
 * 1. 调用 findMatchingModel 查找匹配的模型
 * 2. 验证模型是否可用
 * 3. 返回验证结果或错误信息
 * 
 * @param requestedModel - 用户请求的模型标识符
 * @returns 包含验证结果的对象
 *   - success: true 表示验证成功，false 表示失败
 *   - model: 匹配的模型 ID（成功时）
 *   - error: 错误详情（失败时）
 * 
 * @example
 * // 成功匹配
 * validateAndReplaceModel("claude-3-5-sonnet")
 * // 返回：{ success: true, model: "claude-3.5-sonnet" }
 * 
 * // 匹配失败
 * validateAndReplaceModel("unknown-model")
 * // 返回：{ success: false, error: { ... } }
 */
export function validateAndReplaceModel(requestedModel: string): {
  success: boolean
  model?: string
  error?: {
    message: string
    code: string
    param: string
    type: string
  }
} {
  // 获取所有有效的可用模型列表
  const availableModels = state.models?.data.filter(
    (m) => typeof m.capabilities?.limits?.max_context_window_tokens === "number",
  )
  const availableModelIds = availableModels?.map((m) => m.id) || []

  // 尝试查找匹配的模型
  const matchedModel = findMatchingModel(requestedModel)

  // ========== 验证失败：未找到匹配的模型 ==========
  if (!matchedModel) {
    consola.error(`❌ 模型不可用：${requestedModel}`)
    consola.error(`可用模型列表：${availableModelIds.join(", ")}`)

    return {
      success: false,
      error: {
        message: `请求的模型 '${requestedModel}' 不受支持。可用模型：${availableModelIds.join(", ")}`,
        code: "model_not_supported",
        param: "model",
        type: "invalid_request_error",
      },
    }
  }

  // ========== 验证成功：记录结果 ==========
  if (matchedModel !== requestedModel) {
    // 模型被替换（通过模糊匹配找到）
    consola.success(
      `✓ 模型匹配并替换：${requestedModel} -> ${matchedModel}`,
    )
  } else {
    // 精确匹配
    consola.success(`✓ 模型验证通过：${matchedModel}`)
  }

  return {
    success: true,
    model: matchedModel,
  }
}
