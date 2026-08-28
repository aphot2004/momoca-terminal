/**
 * Escape closes every dialog, and closes only the top of a nested stack.
 *
 * Run it the way the screenshot script runs, against a throwaway profile:
 *
 *   npm run build
 *   ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     test/suites/esctest.mjs --user-data-dir=/tmp/momoca-esc
 *
 * A main-process suite rather than a CDP one: it needs sendInputEvent to
 * deliver a real key, and CDP cannot screenshot an occluded window anyway.
 */
const { app, BrowserWindow } = require('electron')
require('../../out/main/index.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await app.whenReady(); await sleep(2500)
  const win = BrowserWindow.getAllWindows()[0]
  const js = (c) => win.webContents.executeJavaScript(c, true)
  const esc = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await sleep(500)
  }
  const open = async (sel, text) => {
    await js(`(() => { const e=[...document.querySelectorAll('${sel}')].find(x=>x.innerText&&x.innerText.includes(${JSON.stringify(text)})); if(!e) return 'missing'; e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); e.click(); return 'ok' })()`)
    await sleep(1100)
  }
  const modals = () => js(`document.querySelectorAll('.scrim').length`)

  const results = []
  for (const [label, sel, text] of [
    ['Requirements guide', '.ribbon-btn', 'Requirements'],
    ['Key manager', '.ribbon-btn', 'Keys'],
    ['Tunnels', '.ribbon-btn', 'Tunneling'],
    ['Network tools', '.ribbon-btn', 'Network'],
    ['Macros', '.ribbon-btn', 'Macros'],
    ['Tools', '.ribbon-btn', 'Tools'],
    ['Unix tools', '.ribbon-btn', 'Unix'],
    ['New session', '.ribbon-btn', 'Session']
  ]) {
    await open(sel, text)
    const before = await modals()
    await esc()
    const after = await modals()
    results.push(`${before === 1 && after === 0 ? 'PASS' : 'FAIL'}  ${label} (open:${before} after-esc:${after})`)
    if (after > 0) await js(`document.querySelectorAll('.scrim').forEach(s=>s.remove())`)
  }

  // Nested: the settings dialog, then a prompt on top of it.
  await open('.menubar-item', 'Settings'); await sleep(400)
  await open('.ctx-item', 'Keyboard shortcuts')
  const nestedBefore = await modals()
  await esc()
  const nestedAfter = await modals()
  results.push(`${nestedBefore >= 1 && nestedAfter === 0 ? 'PASS' : 'FAIL'}  settings closes on Escape (${nestedBefore} -> ${nestedAfter})`)

  console.log(results.join('\n'))
  console.log(`\n${results.filter(r=>r.startsWith('PASS')).length}/${results.length} passed`)
  app.quit()
}
main().catch((e) => { console.error(e); app.quit() })
