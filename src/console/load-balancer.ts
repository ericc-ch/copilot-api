import { type Account, getAccounts } from "./account-store"
import { getInstanceState } from "./instance-manager"

let rrIndex = 0

export function getRunningAccounts(accounts: Array<Account>): Array<Account> {
  return accounts.filter(
    (a) => a.enabled && getInstanceState(a.id) !== undefined,
  )
}

export async function selectAccount(
  strategy: "round-robin" | "priority",
  exclude?: Set<string>,
): Promise<{ account: Account; state: import("~/lib/state").State } | null> {
  const all = await getAccounts()
  let running = getRunningAccounts(all)

  if (exclude?.size) {
    running = running.filter((a) => !exclude.has(a.id))
  }

  if (running.length === 0) return null

  let selected: Account

  if (strategy === "priority") {
    running.sort((a, b) => b.priority - a.priority)
    selected = running[0]
  } else {
    rrIndex = rrIndex % running.length
    selected = running[rrIndex]
    rrIndex = (rrIndex + 1) % running.length
  }

  const state = getInstanceState(selected.id)
  if (!state) return null

  return { account: selected, state }
}
