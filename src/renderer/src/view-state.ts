import { useSyncExternalStore } from 'react'

/**
 * View state that the terminal needs to read from *inside* its construction
 * closure — the xterm instance is built once per tab, so props captured at that
 * moment go stale. A tiny store avoids threading refs through several layers.
 */
export type SplitLayout = 'single' | 'cols2' | 'rows2' | 'grid4'

export const SPLIT_PANES: Record<SplitLayout, number> = {
  single: 1,
  cols2: 2,
  rows2: 2,
  grid4: 4
}

export interface PaneRect {
  top: string
  left: string
  width: string
  height: string
}

/** Where each pane sits, as percentages of the terminal area. */
export const PANE_RECTS: Record<SplitLayout, PaneRect[]> = {
  single: [{ top: '0', left: '0', width: '100%', height: '100%' }],
  cols2: [
    { top: '0', left: '0', width: '50%', height: '100%' },
    { top: '0', left: '50%', width: '50%', height: '100%' }
  ],
  rows2: [
    { top: '0', left: '0', width: '100%', height: '50%' },
    { top: '50%', left: '0', width: '100%', height: '50%' }
  ],
  grid4: [
    { top: '0', left: '0', width: '50%', height: '50%' },
    { top: '0', left: '50%', width: '50%', height: '50%' },
    { top: '50%', left: '0', width: '50%', height: '50%' },
    { top: '50%', left: '50%', width: '50%', height: '50%' }
  ]
}

/** MobaXterm's three button sizes for the buttons bar. */
export type ButtonSize = 'small' | 'standard' | 'captions'

export type SidebarSide = 'left' | 'right'

interface ViewState {
  /** Keystrokes go to every visible terminal at once (MobaXterm's MultiExec). */
  multiExec: boolean
  /**
   * Who MultiExec types to. 'visible' is the panes on screen — the original
   * behaviour, and still the default. 'all' is every open tab, on screen or
   * not. An array is an explicit hand-picked set of tab ids.
   */
  multiExecScope: 'visible' | 'all' | string[]
  /** Tabs currently on screen — the panes MultiExec's 'visible' scope means. */
  visibleTabs: string[]
  /** Every open tab, on screen or not, in tab-strip order. */
  openTabs: string[]
  fontSize: number
  layout: SplitLayout
  compact: boolean
  showStats: boolean
  /** The Terminal/Sessions/View/... strip above the buttons bar. */
  menuBar: boolean
  /** MobaXterm's name for the ribbon of icon buttons. */
  buttonsBar: boolean
  buttonSize: ButtonSize
  sidebarSide: SidebarSide
  tabNumbers: boolean
  tabClose: boolean
}

const FONT_MIN = 8
const FONT_MAX = 28
const STORAGE_KEY = 'mobaclone.view'

const DEFAULTS: ViewState = {
  multiExec: false,
  multiExecScope: 'visible',
  visibleTabs: [],
  openTabs: [],
  fontSize: 13,
  layout: 'single',
  compact: false,
  showStats: true,
  menuBar: true,
  buttonsBar: true,
  buttonSize: 'captions',
  sidebarSide: 'left',
  tabNumbers: true,
  tabClose: true
}

function load(): ViewState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      ...DEFAULTS,
      fontSize: Number(saved.fontSize) || DEFAULTS.fontSize,
      layout: saved.layout ?? DEFAULTS.layout,
      compact: Boolean(saved.compact),
      showStats: saved.showStats !== false,
      menuBar: saved.menuBar !== false,
      buttonsBar: saved.buttonsBar !== false,
      buttonSize: saved.buttonSize ?? DEFAULTS.buttonSize,
      sidebarSide: saved.sidebarSide === 'right' ? 'right' : 'left',
      tabNumbers: saved.tabNumbers !== false,
      tabClose: saved.tabClose !== false
    }
  } catch {
    return DEFAULTS
  }
}

/** Writes the persistable half of the view state back to localStorage. */
function persist(): void {
  // MultiExec and the visible-tab list are deliberately not persisted: both are
  // about the current moment, and restoring broadcast-to-all on launch would be
  // a nasty surprise.
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fontSize: state.fontSize,
      layout: state.layout,
      compact: state.compact,
      showStats: state.showStats,
      menuBar: state.menuBar,
      buttonsBar: state.buttonsBar,
      buttonSize: state.buttonSize,
      sidebarSide: state.sidebarSide,
      tabNumbers: state.tabNumbers,
      tabClose: state.tabClose
    })
  )
}

let state: ViewState = load()
const listeners = new Set<() => void>()

function emit(next: Partial<ViewState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
  persist()
}

export const viewActions = {
  setMultiExec: (on: boolean) => emit({ multiExec: on }),
  toggleMultiExec: () => emit({ multiExec: !state.multiExec }),
  setMultiExecScope: (scope: 'visible' | 'all' | string[]) => emit({ multiExecScope: scope }),
  /** Tick or untick one tab, switching to an explicit set on the first tick. */
  toggleMultiExecTarget: (tabId: string) => {
    const current = Array.isArray(state.multiExecScope)
      ? state.multiExecScope
      : state.multiExecScope === 'all'
        ? state.openTabs
        : state.visibleTabs
    const next = current.includes(tabId)
      ? current.filter((id) => id !== tabId)
      : [...current, tabId]
    emit({ multiExecScope: next })
  },
  setOpenTabs: (tabs: string[]) => {
    if (tabs.length === state.openTabs.length && tabs.every((t, i) => state.openTabs[i] === t)) {
      return
    }
    // A closed tab must not linger in a hand-picked MultiExec set, or the next
    // keystroke goes to a dead id.
    const scope = state.multiExecScope
    const pruned = Array.isArray(scope) ? scope.filter((id) => tabs.includes(id)) : scope
    emit({ openTabs: tabs, multiExecScope: pruned })
  },
  setVisibleTabs: (tabs: string[]) => {
    // Called on every render pass; skip the notify when nothing moved.
    if (tabs.length === state.visibleTabs.length && tabs.every((t, i) => state.visibleTabs[i] === t)) {
      return
    }
    emit({ visibleTabs: tabs })
  },
  setLayout: (layout: SplitLayout) => emit({ layout }),
  setFontSize: (size: number) => emit({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, size)) }),
  zoom: (by: number) => viewActions.setFontSize(state.fontSize + by),
  resetZoom: () => emit({ fontSize: 13 }),
  toggleCompact: () => emit({ compact: !state.compact }),
  toggleStats: () => emit({ showStats: !state.showStats }),
  toggleMenuBar: () => emit({ menuBar: !state.menuBar }),
  toggleButtonsBar: () => emit({ buttonsBar: !state.buttonsBar }),
  /** MobaXterm's "Show both": bring the menu bar and the buttons bar back. */
  showBothBars: () => emit({ menuBar: true, buttonsBar: true, compact: false }),
  setButtonSize: (buttonSize: ButtonSize) => emit({ buttonSize }),
  setSidebarSide: (sidebarSide: SidebarSide) => emit({ sidebarSide }),
  toggleTabNumbers: () => emit({ tabNumbers: !state.tabNumbers }),
  toggleTabClose: () => emit({ tabClose: !state.tabClose }),
  /** Settings ▸ Reset configuration. Keeps the live session state alone. */
  reset: () =>
    emit({
      fontSize: DEFAULTS.fontSize,
      layout: DEFAULTS.layout,
      compact: DEFAULTS.compact,
      showStats: DEFAULTS.showStats,
      menuBar: DEFAULTS.menuBar,
      buttonsBar: DEFAULTS.buttonsBar,
      buttonSize: DEFAULTS.buttonSize,
      sidebarSide: DEFAULTS.sidebarSide,
      tabNumbers: DEFAULTS.tabNumbers,
      tabClose: DEFAULTS.tabClose
    })
}

/** Settings ▸ Export configuration: the persisted half of the view state. */
export function exportView(): Record<string, unknown> {
  return {
    fontSize: state.fontSize,
    layout: state.layout,
    compact: state.compact,
    showStats: state.showStats,
    menuBar: state.menuBar,
    buttonsBar: state.buttonsBar,
    buttonSize: state.buttonSize,
    sidebarSide: state.sidebarSide,
    tabNumbers: state.tabNumbers,
    tabClose: state.tabClose
  }
}

/** Settings ▸ Import configuration. Unknown keys are ignored. */
export function importView(input: Record<string, unknown>): void {
  const next: Partial<ViewState> = {}
  if (typeof input.fontSize === 'number') next.fontSize = input.fontSize
  if (typeof input.layout === 'string' && input.layout in SPLIT_PANES) {
    next.layout = input.layout as SplitLayout
  }
  if (typeof input.compact === 'boolean') next.compact = input.compact
  if (typeof input.showStats === 'boolean') next.showStats = input.showStats
  if (typeof input.menuBar === 'boolean') next.menuBar = input.menuBar
  if (typeof input.buttonsBar === 'boolean') next.buttonsBar = input.buttonsBar
  if (input.buttonSize === 'small' || input.buttonSize === 'standard' || input.buttonSize === 'captions') {
    next.buttonSize = input.buttonSize
  }
  if (input.sidebarSide === 'left' || input.sidebarSide === 'right') {
    next.sidebarSide = input.sidebarSide
  }
  if (typeof input.tabNumbers === 'boolean') next.tabNumbers = input.tabNumbers
  if (typeof input.tabClose === 'boolean') next.tabClose = input.tabClose
  emit(next)
}

/** The view state as seen by menus and other read-only consumers. */
export type ViewSnapshot = ViewState

export function getView(): ViewState {
  return state
}

export function useView(): ViewState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}

/**
 * Where a keystroke from `tabId` should actually go.
 *
 * With MultiExec off this is just the originating tab. With it on the input is
 * mirrored to every visible terminal — the originating one included, exactly
 * once, so a tab that is somehow missing from the visible list still echoes.
 */
export function broadcastTargets(tabId: string): string[] {
  if (!state.multiExec) return [tabId]

  const scope = state.multiExecScope
  const chosen = Array.isArray(scope)
    ? scope
    : scope === 'all'
      ? state.openTabs
      : state.visibleTabs

  // The originating tab always echoes, even if it somehow fell out of the set —
  // typing into a terminal that does not show what you typed is indefensible.
  const targets = chosen.length ? chosen : [tabId]
  return targets.includes(tabId) ? targets : [...targets, tabId]
}

/** Tabs MultiExec would currently type into, for the UI to tick. */
export function multiExecSelection(): string[] {
  const scope = state.multiExecScope
  if (Array.isArray(scope)) return scope
  return scope === 'all' ? state.openTabs : state.visibleTabs
}
