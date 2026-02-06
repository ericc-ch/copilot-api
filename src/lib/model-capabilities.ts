import { state } from "~/lib/state"

export const modelSupportsResponses = (modelId: string): boolean => {
  const model = state.models?.data.find((entry) => entry.id === modelId)
  return Boolean(model?.supported_endpoints?.includes("/responses"))
}
