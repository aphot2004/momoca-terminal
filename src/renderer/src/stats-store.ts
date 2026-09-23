import { useSyncExternalStore } from 'react'
import type { RemoteStats, SystemStats } from '@shared/types'

/**
 * The diagnostics bar's data, deliberately kept out of React state.
 *
 * Metrics arrive twice a second. Held in `App`, every one of those ticks
 * re-rendered the entire application — menu bar, buttons bar, sidebar, tab
 * strip, every terminal pane — to move six meters in a 26px strip. Here only
 * the components that read metrics subscribe, so the rest of the window sits
 * still between the things a *person* did.
 *
 * The same store carries the appetite declaration in the other direction: what
 * the bar is showing decides what the main process bothers to sample.
 */
interface StatsState {
  local: SystemStats | null
  /** Server metrics keyed by tab, so switching tabs switches the bar. */
  remote: Record<string, RemoteStats>
}

let state: StatsState = { local: null, remote: {} }
const listeners = new Set<() => void>()

function emit(next: StatsState): void {
  state = next
  for (const listener of listeners) listener()
}

let needs = { summary: false, detail: false }

function pushNeeds(next: { summary: boolean; detail: boolean }): void {
  if (next.summary === needs.summary && next.detail === needs.detail) return
  needs = next
  void window.api.stats.setNeeds(needs).catch(() => {})
}

export const statsActions = {
  setLocal: (local: SystemStats) => emit({ ...state, local }),
  setRemote: (tabId: string, remote: RemoteStats) =>
    emit({ ...state, remote: { ...state.remote, [tabId]: remote } }),
  /** Forget a closed tab's last sample rather than holding it for the session. */
  dropTab: (tabId: string) => {
    if (!(tabId in state.remote)) return
    const remote = { ...state.remote }
    delete remote[tabId]
    emit({ ...state, remote })
  },
  /** The bar is mounted and wants samples. */
  setSummaryWanted: (on: boolean) => pushNeeds({ summary: on, detail: on && needs.detail }),
  /** The hover popover is open and wants the expensive half too. */
  setDetailWanted: (on: boolean) => pushNeeds({ ...needs, detail: on })
}

export function useStats(): StatsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
