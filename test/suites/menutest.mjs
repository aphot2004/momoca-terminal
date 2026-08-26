// The MobaXterm-style menu bar: every menu opens, its items are reachable at
// real coordinates, submenus expand, and the View menu's switches actually move
// the UI. Same rules as the other suites — click where a human would click, and
// assert on side effects rather than on painted text.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts')
mkdirSync(OUT, { recursive: true })

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
let n = 0
const w = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  const r = w.get(m.id)
  if (r) {
    w.delete(m.id)
    r(m)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++n
    w.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
    // Page.captureScreenshot never answers while the window is occluded, and a
    // suite that hangs is worse than one that skips a picture.
    setTimeout(() => {
      if (w.delete(id)) res({ timedOut: true })
    }, 8000)
  })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', {
    expression: x,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails)
    return '__ERR__ ' + r.result.exceptionDetails.exception?.description?.split('\n')[0]
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  else console.error(`(no screenshot for ${name} — is the window occluded?)`)
}
await new Promise((r) => ws.addEventListener('open', r))

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

/** Where an element is, and whether a click there would actually reach it. */
const probe = async (selector, text = null) => {
  const raw = await ev(`
    (() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = ${
        text === null
          ? 'all[0]'
          : `all.find(e => e.innerText && e.innerText.includes(${JSON.stringify(text)}))`
      }
      if (!el) return JSON.stringify({ found: false })
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return JSON.stringify({ found: true, visible: false })
      const x = Math.round(r.left + r.width / 2)
      const y = Math.round(r.top + r.height / 2)
      const top = document.elementFromPoint(x, y)
      const reachable = el === top || el.contains(top) || (top && top.contains(el))
      return JSON.stringify({
        found: true, visible: true, x, y, reachable,
        blockedBy: reachable ? null : top ? top.className || top.tagName : 'nothing'
      })
    })()
  `)
  return JSON.parse(String(raw))
}

const moveTo = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
  await sleep(250)
}

const clickAt = async (x, y) => {
  await moveTo(x, y)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(300)
}

const click = async (selector, text = null, label = null) => {
  const p = await probe(selector, text)
  const what = label ?? `${text ?? selector}`
  if (!p.found) return rec(`click "${what}"`, false, 'not found'), false
  if (!p.visible) return rec(`click "${what}"`, false, 'zero size'), false
  if (!p.reachable) return rec(`click "${what}"`, false, `covered by .${p.blockedBy}`), false
  await clickAt(p.x, p.y)
  return true
}

const escape = async () => {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 'x'`)
  await sleep(250)
}

// Start clean: no stray modal, and both chrome bars showing.
await ev(`
  (() => {
    for (let i = 0; i < 4; i++) {
      const btn = [...document.querySelectorAll('.modal-actions .btn')]
        .find(b => /^(Done|Close|Cancel)$/.test(b.innerText.trim()))
      if (!btn) break
      btn.click()
    }
    const saved = JSON.parse(localStorage.getItem('mobaclone.view') ?? '{}')
    localStorage.setItem('mobaclone.view', JSON.stringify({ ...saved, menuBar: true, buttonsBar: true, compact: false, sidebarSide: 'left' }))
    return 'cleared'
  })()
`)
await escape()
// The view store is read at startup, so reload to pick the reset bars up.
await ev(`location.reload(), 'x'`)
await sleep(2500)

// ---------- the bar itself ----------
const titles = ['Terminal', 'Sessions', 'View', 'X server', 'Tools', 'Macros', 'Settings', 'Help']
const barText = String(await ev(`document.querySelector('.menubar')?.innerText ?? ''`))
rec('menu bar is present', barText.length > 0, barText.replace(/\n/g, ' '))
for (const title of titles) {
  rec(`menu bar has "${title}"`, barText.includes(title))
}

// ---------- every menu opens, and its items are clickable ----------
for (const title of titles) {
  const opened = await click('.menubar-item', title, `${title} menu`)
  if (!opened) continue
  const count = Number(await ev(`document.querySelectorAll('.ctx-menu .ctx-item').length`))
  const first = await probe('.ctx-menu .ctx-item')
  rec(`${title} menu opens`, count > 0, `${count} items`)
  rec(`${title} menu items are reachable`, first.reachable === true, first.blockedBy ?? 'topmost')
  await escape()
}

// ---------- MobaXterm's own labels ----------
await click('.menubar-item', 'Terminal')
const terminalItems = String(await ev(`document.querySelector('.ctx-menu')?.innerText ?? ''`))
for (const label of [
  'Open new tab',
  'Duplicate current tab',
  'Set tab title',
  'Find in terminal',
  'Save terminal text',
  'Print terminal text',
  'Write commands on all terminals'
]) {
  rec(`Terminal ▸ ${label}`, terminalItems.includes(label))
}
await escape()

await click('.menubar-item', 'Tools')
const toolHeadings = JSON.parse(
  String(await ev(`JSON.stringify([...document.querySelectorAll('.ctx-heading')].map(h => h.innerText))`))
)
// innerText reports what is painted, and the headings are uppercased by CSS.
const groups = toolHeadings.map((h) => h.toLowerCase()).join(',')
rec("Tools menu keeps MobaXterm's groups", groups === 'system,office,network', groups)
await escape()

// ---------- submenus ----------
await click('.menubar-item', 'Sessions')
const userSessions = await probe('.ctx-item', 'User sessions')
if (userSessions.found && userSessions.visible) {
  await moveTo(userSessions.x, userSessions.y)
  await sleep(400)
  const menus = Number(await ev(`document.querySelectorAll('.ctx-menu').length`))
  rec('Sessions ▸ User sessions opens a submenu', menus > 1, `${menus} menus on screen`)
  await shot('menutest-sessions-submenu')
} else {
  rec('Sessions ▸ User sessions opens a submenu', false, 'item missing')
}
await escape()

// ---------- View menu switches move the UI ----------
const ribbonVisible = async () =>
  Number(await ev(`document.querySelectorAll('.ribbon').length`))
const menubarVisible = async () =>
  Number(await ev(`document.querySelectorAll('.menubar').length`))

await click('.menubar-item', 'View')
await click('.ctx-item', 'Show buttons bar')
rec('View ▸ Show buttons bar hides the ribbon', (await ribbonVisible()) === 0)

// With the ribbon gone the tab strip must still offer a way back.
const chevron = await probe('.new-tab.compact-view')
rec('a hidden buttons bar leaves a door back', chevron.found && chevron.reachable === true)
if (chevron.found && chevron.reachable) {
  await clickAt(chevron.x, chevron.y)
  await click('.ctx-item', 'Show both')
}
rec('View ▸ Show both restores the ribbon', (await ribbonVisible()) === 1)

// Small buttons drop the captions but keep every button.
const buttonCount = Number(await ev(`document.querySelectorAll('.ribbon-btn').length`))
await click('.menubar-item', 'View')
await click('.ctx-item', 'Small buttons')
const smallLabels = Number(
  await ev(`[...document.querySelectorAll('.ribbon-label')].filter(l => l.offsetWidth > 0).length`)
)
rec('View ▸ Small buttons hides the captions', smallLabels === 0, `${smallLabels} visible labels`)
rec('…and keeps every button', Number(await ev(`document.querySelectorAll('.ribbon-btn').length`)) === buttonCount)
await click('.menubar-item', 'View')
await click('.ctx-item', 'Standard buttons with captions')

// The sidebar can change sides.
await click('.menubar-item', 'View')
await click('.ctx-item', 'Put sidebar on the right')
const sideRight = JSON.parse(
  String(await ev(`
    (() => {
      const bar = document.querySelector('.sidebar')?.getBoundingClientRect()
      const main = document.querySelector('.main')?.getBoundingClientRect()
      return JSON.stringify({ bar: bar?.left ?? -1, main: main?.left ?? -1 })
    })()
  `))
)
rec('View ▸ Put sidebar on the right moves it', sideRight.bar > sideRight.main, JSON.stringify(sideRight))
await shot('menutest-sidebar-right')
await click('.menubar-item', 'View')
await click('.ctx-item', 'Put sidebar on the left')

// Hiding the menu bar is reversible without the menu bar (⌘⇧M).
await click('.menubar-item', 'View')
await click('.ctx-item', 'Show menu bar')
rec('View ▸ Show menu bar hides it', (await menubarVisible()) === 0)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true, shiftKey: true })), 'x'`)
await sleep(400)
rec('⌘⇧M brings the menu bar back', (await menubarVisible()) === 1)

// ---------- Settings and Help dialogs ----------
await click('.menubar-item', 'Settings')
await click('.ctx-item', 'Keyboard shortcuts')
const shortcutRows = Number(await ev(`document.querySelectorAll('.shortcut-table tr').length`))
rec('Settings ▸ Keyboard shortcuts opens', shortcutRows > 5, `${shortcutRows} rows`)
await shot('menutest-shortcuts')
await click('.modal-actions .btn', 'Done')

await click('.menubar-item', 'Help')
await click('.ctx-item', 'About MoMoca')
const aboutText = String(await ev(`document.querySelector('.modal')?.innerText ?? ''`))
rec('Help ▸ About opens', aboutText.includes('About MoMoca'))
await click('.modal-actions .btn', 'Close')

await shot('menutest-final')
console.log(results.join('\n'))
console.log(
  `\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`
)
ws.close()
