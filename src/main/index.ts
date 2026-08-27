import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { stopAllTunnels } from './ssh/tunnels'
import { collectStats } from './system-stats'
import { disposeAll } from './terminals/registry'

const STATS_INTERVAL_MS = 2000

/** Store files this app owns. Chromium's own caches are not ours to move. */
const STORE_FILES = ['sessions.json', 'keys.json', 'macros.json', 'tunnels.json', 'vault.json']

/**
 * Carry the store across the MobaClone → MoMoca rename.
 *
 * `userData` is derived from the app name, so renaming moves the directory and
 * would strand every saved session, imported key and vault entry in the old
 * one. This copies them across on the first launch under the new name — a copy,
 * never a move: the old directory stays exactly as it was, so a bad migration
 * costs nothing and the previous build still runs.
 *
 * Secrets sealed with `safeStorage` are a separate matter. Their key lives in
 * the login Keychain under the *running* app's name, so a packaged MobaClone's
 * sealed passwords cannot be read by a packaged MoMoca and must be re-entered.
 * Sessions, keys and macros all survive; only the sealed secrets do not.
 */
function migrateStore(): void {
  const target = app.getPath('userData')
  // Anything already here is authoritative; never write over a live store.
  if (existsSync(join(target, 'sessions.json'))) return

  const parent = dirname(target)
  // 'momoca' is the dev store (package name); 'MoMoca' is the packaged one
  // (product name). They are different directories, so each can seed the other.
  for (const previous of ['momoca', 'MoMoca', 'mobaxterm-clone', 'MobaClone']) {
    const source = join(parent, previous)
    if (source === target || !existsSync(join(source, 'sessions.json'))) continue

    mkdirSync(target, { recursive: true })
    for (const name of STORE_FILES) {
      const from = join(source, name)
      if (!existsSync(from)) continue
      copyFileSync(from, join(target, name))
    }
    // cpSync's `mode` is a copy *flag* field, not permissions — passing 0o600
    // there throws. The key store's own 0700/0600 modes ride along with the copy.
    const keys = join(source, 'keys')
    if (existsSync(keys)) cpSync(keys, join(target, 'keys'), { recursive: true })

    console.log(`[momoca] carried the store over from ${previous}`)
    return
  }
}

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 440,
    show: false,
    backgroundColor: '#11131a',
    // Keeps the traffic lights floating over our own tab strip, the way
    // native Mac terminals do.
    titleBarStyle: 'hiddenInset',
    // Vertically centred in the 28px title strip the renderer draws.
    trafficLightPosition: { x: 12, y: 7 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Poll host metrics for the diagnostics bar. Overlapping samples would skew
  // the CPU and network deltas, so each tick waits for the previous one.
  let statsTimer: NodeJS.Timeout | null = null
  const tick = async () => {
    if (window.isDestroyed()) return
    try {
      window.webContents.send('stats:update', await collectStats())
    } catch {
      /* a failed sample is not worth surfacing */
    }
    if (!window.isDestroyed()) statsTimer = setTimeout(tick, STATS_INTERVAL_MS)
  }
  statsTimer = setTimeout(tick, 400)

  window.on('closed', () => {
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(() => {
  migrateStore()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeAll()
  stopAllTunnels()
})
