/**
 * Capture the README screenshots.
 *
 *   ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     scripts/shoot.js --user-data-dir=/tmp/momoca-shots
 *
 * Two things make this a main-process script rather than a CDP one:
 * `Page.captureScreenshot` never answers while the window is occluded, and it
 * is occluded whenever the capture is driven from a terminal — but
 * `webContents.capturePage()` reads the compositor directly and does not care.
 * Driving the renderer with `executeJavaScript` from the same process keeps it
 * to one moving part.
 *
 * ALWAYS run this against a throwaway `--user-data-dir`. It seeds fixture
 * sessions, and pointing it at the real store would both pollute it and put
 * real host names in a public screenshot.
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

// Match the icon pipeline: no display profile baked into the PNGs.
app.commandLine.appendSwitch('force-color-profile', 'srgb')

const OUT = join(__dirname, '..', 'docs')
mkdirSync(OUT, { recursive: true })

// Boot the real application; everything below drives the window it opens.
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fixture hosts. RFC1918 addresses that resolve to nothing, on purpose. */
const FIXTURES = [
  { name: 'web-01', kind: 'ssh', folder: 'Production', host: '10.0.4.11', username: 'deploy', port: 22, authMethod: 'agent', trackCwd: true },
  { name: 'web-02', kind: 'ssh', folder: 'Production', host: '10.0.4.12', username: 'deploy', port: 22, authMethod: 'agent', trackCwd: true },
  { name: 'db-primary', kind: 'ssh', folder: 'Production', host: '10.0.4.20', username: 'postgres', port: 22, authMethod: 'agent', trackCwd: true },
  { name: 'build-runner', kind: 'ssh', folder: 'Staging', host: '10.0.9.3', username: 'ci', port: 22, authMethod: 'agent', trackCwd: true },
  { name: 'edge-router', kind: 'telnet', folder: 'Staging', host: '10.0.0.1', port: 23 }
]

async function main() {
  await app.whenReady()
  await sleep(2500)

  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('no window')
  win.setSize(1440, 900)
  const js = (code) => win.webContents.executeJavaScript(code, true)

  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    writeFileSync(join(OUT, `${name}.png`), image.toPNG())
    console.log('wrote', name)
  }

  /** Type into whatever has focus, one character at a time, like a person. */
  const type = async (text) => {
    for (const ch of text) {
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep(12)
    }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await sleep(500)
  }

  const clickText = (selector, text) =>
    js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((e) => e.innerText && e.innerText.includes(${JSON.stringify(text)}))
      if (!el) return 'missing'
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.click()
      return 'ok'
    })()`)

  const newTab = async () => {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true })), 'x'`)
    await sleep(1800)
  }

  // --- fixtures -------------------------------------------------------------
  await js(`(async () => {
    for (const f of ${JSON.stringify(FIXTURES)}) await window.api.sessions.save(f)
    return 'seeded'
  })()`)
  await js(`location.reload(), 'x'`)
  await sleep(2500)

  // --- 0. the welcome screen, before any tab exists ------------------------
  await shot('screenshot-welcome')

  // --- 1. the terminal, with a prompt that names nobody ---------------------
  await newTab()
  await type("cd /tmp && PS1='deploy@web-01:~$ ' && clear")
  await type('uptime')
  await type('ps -eo pid,pcpu,comm | head -6')
  await sleep(900)
  await shot('screenshot-terminal')

  // --- 2. the menu bar ------------------------------------------------------
  await clickText('.menubar-item', 'Tools')
  await sleep(700)
  await shot('screenshot-menus')
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 'x'`)
  await sleep(400)

  // --- 3. four terminals, all typed into at once ---------------------------
  for (let i = 0; i < 3; i++) {
    await newTab()
    await type("PS1='node-0" + (i + 2) + ":~$ ' && clear")
  }
  await clickText('.menubar-item', 'View')
  await sleep(600)
  await clickText('.ctx-item', '4 terminals mode')
  await sleep(1200)
  await clickText('.ribbon-btn', 'MultiExec')
  await sleep(600)
  await type('echo "deploy ok" && uptime')
  await sleep(1000)
  await shot('screenshot-split')
  await clickText('.ribbon-btn', 'MultiExec')
  await sleep(400)
  await clickText('.menubar-item', 'View')
  await sleep(600)
  await clickText('.ctx-item', 'Single terminal mode')
  await sleep(900)

  // --- 4. the tools workspace ----------------------------------------------
  await clickText('.ribbon-btn', 'Tools')
  await sleep(1400)
  // Deliberately NOT "Running processes": it lists the real account name in
  // every row, plus home paths and installed applications.
  await clickText('.tools-item', 'SSH key generator')
  await sleep(900)
  await shot('screenshot-tools')
  await clickText('.modal-actions .btn', 'Done')
  await sleep(600)

  // --- 5. the light theme ---------------------------------------------------
  await clickText('.ribbon-btn', 'Theme')
  await sleep(900)
  await shot('screenshot-light')

  console.log('done')
  app.quit()
}

main().catch((err) => {
  console.error(err)
  app.quit()
})
