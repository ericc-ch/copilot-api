import { state } from "~/lib/state"

import { type AnthropicResponse } from "./anthropic-types"

interface ParsedAnthropicModel {
  family: "claude"
  tier: "haiku" | "opus" | "sonnet"
  major: number
  minor?: number
  allowMajorOnlyFallback: boolean
}

export function mapOpenAIStopReasonToAnthropic(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) {
    return null
  }
  const stopReasonMap = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const
  return stopReasonMap[finishReason]
}

export function resolveModelId(requestedModel: string): string {
  const availableModels = state.models?.data ?? []

  if (availableModels.length === 0) {
    return requestedModel
  }

  const availableModelIds = new Set(availableModels.map((model) => model.id))
  const candidates = getModelCandidates(requestedModel)

  for (const candidate of candidates) {
    if (availableModelIds.has(candidate)) {
      return candidate
    }
  }

  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeModelId(candidate)),
  )

  const normalizedMatch = availableModels.find((model) =>
    normalizedCandidates.has(normalizeModelId(model.id)),
  )

  if (normalizedMatch) {
    return normalizedMatch.id
  }

  const requestedAnthropicModel = parseAnthropicModel(requestedModel)
  if (!requestedAnthropicModel) {
    return requestedModel
  }

  const anthropicMatches = availableModels
    .map((model) => ({
      id: model.id,
      parsed: parseAnthropicModel(model.id),
    }))
    .filter(
      (model): model is { id: string; parsed: ParsedAnthropicModel } =>
        model.parsed !== null,
    )
    .filter((model) => model.parsed.tier === requestedAnthropicModel.tier)

  const sameVersionMatch = anthropicMatches.find((model) => {
    const sameMajor = model.parsed.major === requestedAnthropicModel.major
    const sameMinor = model.parsed.minor === requestedAnthropicModel.minor
    return sameMajor && sameMinor
  })

  if (sameVersionMatch) {
    return sameVersionMatch.id
  }

  if (requestedAnthropicModel.allowMajorOnlyFallback) {
    const sameMajorMatch = anthropicMatches.find(
      (model) => model.parsed.major === requestedAnthropicModel.major,
    )

    if (sameMajorMatch) {
      return sameMajorMatch.id
    }
  }

  return requestedModel
}

function getModelCandidates(requestedModel: string): Array<string> {
  const candidates = new Set<string>()

  const push = (value: string) => {
    if (value) {
      candidates.add(value)
    }
  }

  push(requestedModel)

  const withoutDate = requestedModel.replace(/-\d{8}$/, "")
  push(withoutDate)

  const withoutVariant = withoutDate.replace(/-(?:latest|thinking)$/, "")
  push(withoutVariant)

  const familyFirstMatch = withoutVariant.match(
    /^claude-(?:haiku|opus|sonnet)-(\d+)(?:-(\d+))?$/,
  )
  if (familyFirstMatch) {
    const [, major, minor] = familyFirstMatch
    const tier = withoutVariant.split("-")[1]
    push(`claude-${tier}-${major}`)
    if (minor) {
      push(`claude-${tier}-${major}-${minor}`)
      push(`claude-${major}.${minor}-${tier}`)
      push(`claude-${major}-${minor}-${tier}`)
    }
  }

  const versionFirstMatch = withoutVariant.match(
    /^claude-(\d+)(?:[.-](\d+))?-(haiku|opus|sonnet)$/,
  )
  if (versionFirstMatch) {
    const [, major, minor, tier] = versionFirstMatch
    push(`claude-${major}${minor ? `.${minor}` : ""}-${tier}`)
    push(minor ? `claude-${major}-${minor}-${tier}` : `claude-${major}-${tier}`)
    push(`claude-${tier}-${major}`)
    if (minor) {
      push(`claude-${tier}-${major}-${minor}`)
    }
  }

  return [...candidates]
}

function normalizeModelId(model: string): string {
  return model.toLowerCase().replaceAll(/[._]/g, "-")
}

function parseAnthropicModel(model: string): ParsedAnthropicModel | null {
  const normalizedModel = model.toLowerCase().replace(/-\d{8}$/, "")

  const familyFirstMatch = normalizedModel.match(
    /^claude-(haiku|opus|sonnet)-(\d+)(?:-(\d+))?(?:-.+)?$/,
  )
  if (familyFirstMatch) {
    const [, tier, major, minor] = familyFirstMatch

    return {
      family: "claude",
      tier: tier as ParsedAnthropicModel["tier"],
      major: Number.parseInt(major, 10),
      minor: minor ? Number.parseInt(minor, 10) : undefined,
      allowMajorOnlyFallback: Boolean(minor),
    }
  }

  const versionFirstMatch = normalizedModel.match(
    /^claude-(\d+)(?:[.-](\d+))?-(haiku|opus|sonnet)(?:-.+)?$/,
  )
  if (versionFirstMatch) {
    const [, major, minor, tier] = versionFirstMatch

    return {
      family: "claude",
      tier: tier as ParsedAnthropicModel["tier"],
      major: Number.parseInt(major, 10),
      minor: minor ? Number.parseInt(minor, 10) : undefined,
      allowMajorOnlyFallback: false,
    }
  }

  return null
}
