import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { stopAllTunnels } from './ssh/tunnels'
import { collectStats } from './system-stats'
import { disposeAll } from './terminals/registry'

const STATS_INTERVAL_MS = 2000

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
