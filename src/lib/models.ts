import type { Model } from "~/services/copilot/get-models"

import { state } from "./state"

const normalizeModelId = (modelId: string): string =>
  modelId
    .trim()
    .toLowerCase()
    .replaceAll(/[\s._-]+/g, "")

const stripSnapshotSuffix = (modelId: string): string => {
  if (modelId.startsWith("claude-sonnet-4-")) {
    return "claude-sonnet-4"
  }

  if (/^claude-opus-4-7-\d{8}$/.test(modelId)) {
    return "claude-opus-4.7"
  }

  if (modelId.startsWith("claude-opus-4-")) {
    return "claude-opus-4"
  }

  return modelId
}

const getAliasCandidates = (modelId: string): Array<string> => {
  const canonicalModelId = stripSnapshotSuffix(modelId.trim().toLowerCase())
  const aliases = new Set<string>([canonicalModelId])

  const familyMatch = canonicalModelId.match(
    /^[a-z]+(?:-[a-z]+)*-\d+(?:\.\d+)?/,
  )
  if (familyMatch) {
    aliases.add(familyMatch[0])
    aliases.add(familyMatch[0].replace(/\.\d+$/, ""))
  }

  if (/^gpt-5(?:[.-]\d+)?$/i.test(canonicalModelId)) {
    aliases.add("gpt-5")
  }

  return [...aliases]
}

const scoreModelCandidate = (model: Model): number => {
  let score = 0

  if (model.model_picker_enabled) {
    score += 20
  }

  if (!model.preview) {
    score += 10
  }

  if (/mini|nano|fast|flash|haiku/i.test(model.id)) {
    score -= 15
  }

  return score - model.id.length / 1000
}

const pickBestModel = (models: Array<Model>): Model | undefined => {
  return [...models].sort(
    (left, right) => scoreModelCandidate(right) - scoreModelCandidate(left),
  )[0]
}

const getBestPrefixMatches = (
  models: Array<Model>,
  aliasCandidates: Array<string>,
): Array<Model> => {
  let bestMatchLength = 0
  const matches: Array<Model> = []

  for (const model of models) {
    const normalizedModelId = normalizeModelId(model.id)
    const matchedAliasLength = Math.max(
      0,
      ...aliasCandidates.map((candidate) => {
        const normalizedCandidate = normalizeModelId(candidate)

        return (
            normalizedCandidate.length >= 4
              && normalizedModelId.startsWith(normalizedCandidate)
          ) ?
            normalizedCandidate.length
          : 0
      }),
    )

    if (matchedAliasLength === 0) {
      continue
    }

    if (matchedAliasLength > bestMatchLength) {
      bestMatchLength = matchedAliasLength
      matches.length = 0
      matches.push(model)
      continue
    }

    if (matchedAliasLength === bestMatchLength) {
      matches.push(model)
    }
  }

  return matches
}

export const resolveModel = (
  requestedModelId: string,
  models: Array<Model> | undefined = state.models?.data,
): Model | undefined => {
  if (!models || models.length === 0) {
    return undefined
  }

  const exactMatch = models.find((model) => model.id === requestedModelId)
  if (exactMatch) {
    return exactMatch
  }

  const aliasCandidates = getAliasCandidates(requestedModelId)
  const normalizedAliases = new Set(
    aliasCandidates.map((candidate) => normalizeModelId(candidate)),
  )

  const normalizedExactMatches = models.filter((model) =>
    normalizedAliases.has(normalizeModelId(model.id)),
  )
  if (normalizedExactMatches.length > 0) {
    return pickBestModel(normalizedExactMatches)
  }

  const familyPrefixMatches = getBestPrefixMatches(models, aliasCandidates)

  return pickBestModel(familyPrefixMatches)
}

export const resolveModelId = (
  requestedModelId: string,
  models: Array<Model> | undefined = state.models?.data,
): string =>
  resolveModel(requestedModelId, models)?.id
  ?? stripSnapshotSuffix(requestedModelId)

export const isClaudeOpus47Model = (modelId: string): boolean =>
  modelId === "claude-opus-4.7"
