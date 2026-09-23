import type { BrowserWindow } from 'electron'
import { collectStats } from './system-stats'
import { setRemoteStatsPaused } from './terminals/registry'

const STATS_INTERVAL_MS = 2000

/**
 * What the diagnostics bar currently wants. Both start false: the renderer
 * declares its appetite as soon as the bar mounts, and a bar that is switched
 * off never asks, so a hidden bar costs nothing at all.
 *
 * This matters more than it looks. A full tick — two process-table walks, a
 * `df` of every mount, an `ioreg` sweep — costs about 75ms of CPU, and used to
 * run every two seconds whether the window was on screen or not: roughly 4% of
 * a core, forever, to fill a 26px strip nobody was looking at.
 */
let needs = { summary: false, detail: false }
/** The window is on screen. A minimised or hidden window reports nothing. */
let onScreen = true

let timer: NodeJS.Timeout | null = null
let target: BrowserWindow | null = null
/** True while a sample is in flight, so a resume can't start a second loop. */
let sampling = false

function polling(): boolean {
  return needs.summary && onScreen
}

async function tick(): Promise<void> {
  timer = null
  const window = target
  if (!window || window.isDestroyed() || !polling()) return

  sampling = true
  try {
    window.webContents.send('stats:update', await collectStats(needs.detail))
  } catch {
    /* a failed sample is not worth surfacing */
  } finally {
    sampling = false
  }

  // Re-check: the bar may have been hidden while the sample was being taken.
  if (!window.isDestroyed() && polling()) timer = setTimeout(() => void tick(), STATS_INTERVAL_MS)
}

/**
 * Start sampling if something wants samples, and stop cleanly if nothing does.
 * `now` skips the wait for the next tick — used when the hover popover opens,
 * so the detail it wants arrives in about 70ms rather than up to two seconds.
 */
function sync(now = false): void {
  const want = polling()
  setRemoteStatsPaused(!want)

  if (!want) {
    if (timer) clearTimeout(timer)
    timer = null
    return
  }
  // A sample already in flight will reschedule itself when it lands.
  if (sampling) return
  if (timer && !now) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void tick(), 0)
}

/** Called by the renderer as the diagnostics bar appears, hides, or is hovered. */
export function setStatsNeeds(next: { summary: boolean; detail: boolean }): void {
  if (next.summary === needs.summary && next.detail === needs.detail) return
  const wantsDetailNow = next.detail && !needs.detail
  needs = next
  sync(wantsDetailNow)
}

/**
 * Bind the poll loop to a window. Sampling follows the window on and off
 * screen: metrics for a machine you cannot see are worth nothing, and the
 * remote poller's cost lands on someone else's server.
 */
export function startStatsPoll(window: BrowserWindow): void {
  target = window
  onScreen = window.isVisible() && !window.isMinimized()

  const track = (visible: boolean) => () => {
    onScreen = visible
    sync()
  }
  window.on('show', track(true))
  window.on('restore', track(true))
  window.on('hide', track(false))
  window.on('minimize', track(false))
  window.on('closed', () => {
    target = null
    if (timer) clearTimeout(timer)
    timer = null
  })

  sync()
}
