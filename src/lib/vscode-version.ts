import { getVSCodeVersion } from "~/services/get-vscode-version"

import { state } from "./state"

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response
}
