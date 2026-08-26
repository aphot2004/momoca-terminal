// Split layouts, MultiExec and the View menu. MultiExec is proven by three
// shells each writing a file named after their own PID from a single burst of
// typing — not by reading the screen.
import { writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

/** Scratch space for fixtures and screenshots, ignored by git. */
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
  })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails)
    return '__ERR__ ' + r.result.exceptionDetails.exception?.description?.split('\n')[0]
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
const clickText = (selector, text) =>
  ev(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(e => e.innerText && e.innerText.includes(${JSON.stringify(text)}))
      if (!el) return 'missing'
      el.click()
      return 'ok'
    })()
  `)
await new Promise((r) => ws.addEventListener('open', r))

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

const clearProof = () => {
  for (const f of readdirSync(OUT).filter((f) => /^mx-\d+\.txt$/.test(f))) {
    rmSync(`${OUT}/${f}`, { force: true })
  }
}

// Clean slate.
await ev(`
  (() => {
    for (let i = 0; i < 5; i++) {
      const b = [...document.querySelectorAll('.modal-actions .btn')]
        .find(x => /^(Done|Close|Cancel)$/.test(x.innerText.trim()))
      if (!b) break
      b.click()
    }
    return 'x'
  })()
`)
await sleep(600)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)
await sleep(800)
clearProof()

// View settings persist, so a previous run can leave compact mode on or a split
// active. Put both back through the UI before asserting the defaults.
if (String(await ev(`document.querySelector('.app')?.className ?? ''`)).includes('compact')) {
  await clickText('.new-tab.compact-view', '\u2304')
  await sleep(500)
  await clickText('.ctx-item', 'Compact mode')
  await sleep(600)
}
await clickText('.ribbon-btn', 'View')
await sleep(500)
await clickText('.ctx-item', 'Single terminal mode')
await sleep(700)

// ---------- three terminals ----------
for (let i = 0; i < 3; i++) {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true })), 'x'`)
  await sleep(2200)
}
rec('three terminals open', Number(await ev(`document.querySelectorAll('.tab').length`)) === 3)

// Only one terminal is visible before splitting.
const visibleBefore = Number(await ev(`document.querySelectorAll('.terminal-pane:not([hidden])').length`))
rec('multitab shows one terminal', visibleBefore === 1, `${visibleBefore} visible`)

// ---------- split layouts ----------
const setLayout = async (label) => {
  await clickText('.ribbon-btn', 'View')
  await sleep(600)
  await clickText('.ctx-item', label)
  await sleep(900)
}

await setLayout('vertical split')
let geo = JSON.parse(String(await ev(`
  JSON.stringify([...document.querySelectorAll('.terminal-pane:not([hidden])')].map(p => {
    const r = p.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }))
`)))
rec('2-terminal split shows two panes', geo.length === 2, `${geo.length} panes`)
rec(
  'panes are side by side',
  geo.length === 2 && geo[0].y === geo[1].y && geo[0].x !== geo[1].x,
  JSON.stringify(geo)
)
await shot('28-split-cols')

await setLayout('horizontal split')
geo = JSON.parse(String(await ev(`
  JSON.stringify([...document.querySelectorAll('.terminal-pane:not([hidden])')].map(p => {
    const r = p.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top) }
  }))
`)))
rec(
  'stacked split puts panes above one another',
  geo.length === 2 && geo[0].x === geo[1].x && geo[0].y !== geo[1].y,
  JSON.stringify(geo)
)

await setLayout('4 terminals')
const four = Number(await ev(`document.querySelectorAll('.terminal-pane:not([hidden])').length`))
// Only three terminals exist, so the fourth slot stays empty.
rec('4-terminal grid shows every open terminal', four === 3, `${four} visible of 3 tabs`)
await shot('29-split-grid')

// ---------- MultiExec ----------
rec('no MultiExec banner before enabling', String(await ev(`!document.querySelector('.multiexec-banner')`)) === 'true')

await clickText('.ribbon-btn', 'MultiExec')
await sleep(700)
const banner = String(await ev(`document.querySelector('.multiexec-banner')?.innerText ?? ''`))
rec('MultiExec banner names the target count', /3 terminals/.test(banner), banner)

// Type once into the focused pane; every visible shell should run it.
await ev(`document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')?.focus(), 'x'`)
await sleep(300)
await send('Input.insertText', { text: `echo hi > ${OUT}/mx-$$.txt` })
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' })

let produced = []
for (let i = 0; i < 20 && produced.length < 3; i++) {
  await sleep(400)
  produced = readdirSync(OUT).filter((f) => /^mx-\d+\.txt$/.test(f))
}
rec(
  'one burst of typing reaches every visible terminal',
  produced.length === 3,
  `${produced.length} distinct shells: ${produced.join(', ')}`
)
await shot('30-multiexec')

// Turning it off must stop the broadcast.
clearProof()
await clickText('.ribbon-btn', 'MultiExec')
await sleep(600)
rec('banner clears when MultiExec is off', String(await ev(`!document.querySelector('.multiexec-banner')`)) === 'true')

await ev(`document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')?.focus(), 'x'`)
await sleep(300)
await send('Input.insertText', { text: `echo hi > ${OUT}/mx-$$.txt` })
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' })
await sleep(3000)
const single = readdirSync(OUT).filter((f) => /^mx-\d+\.txt$/.test(f))
rec('with MultiExec off only one terminal runs it', single.length === 1, `${single.length} shell(s)`)

// ---------- zoom ----------
// The WebGL renderer paints text to a canvas, so no DOM node carries the
// terminal's font size. Read the size the View menu reports, and confirm the
// terminal actually re-fitted by watching its screen width change.
const zoomState = async () => {
  await clickText('.ribbon-btn', 'View')
  await sleep(500)
  const label = String(
    await ev(`[...document.querySelectorAll('.ctx-item')].find(i => i.innerText.includes('Reset zoom'))?.innerText ?? ''`)
  )
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'x'`)
  await sleep(300)
  return Number(/\((\d+)px\)/.exec(label)?.[1] ?? 0)
}
/**
 * Ask the shell how wide it thinks it is. The pane's pixel width is fixed by
 * the split, so only the column count actually moves when the font changes —
 * and asking the shell proves the new size reached the backend, not just the
 * renderer.
 */
const shellColumns = async (tag) => {
  const file = `${OUT}/cols-${tag}.txt`
  rmSync(file, { force: true })
  await ev(`document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')?.focus(), 'x'`)
  await sleep(250)
  await send('Input.insertText', { text: `tput cols > ${file}` })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' })
  for (let i = 0; i < 20; i++) {
    await sleep(300)
    if (existsSync(file)) {
      const cols = Number(readFileSync(file, 'utf8').trim())
      rmSync(file, { force: true })
      if (cols) return cols
    }
  }
  return 0
}

const beforeSize = await zoomState()
const beforeCols = await shellColumns('before')
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true })), 'x'`)
await sleep(900)
const afterSize = await zoomState()
const afterCols = await shellColumns('after')

rec('⌘+ increases the terminal font size', afterSize > beforeSize, `${beforeSize}px -> ${afterSize}px`)
rec(
  'the shell is told the new size after zooming',
  afterCols > 0 && beforeCols > 0 && afterCols < beforeCols,
  `${beforeCols} cols -> ${afterCols} cols`
)

await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true })), 'x'`)
await sleep(900)
rec('⌘0 resets zoom', (await zoomState()) === 13, `back to ${await zoomState()}px`)

// ---------- compact mode ----------
await clickText('.ribbon-btn', 'View')
await sleep(600)
await clickText('.ctx-item', 'Compact mode')
await sleep(700)
const ribbonHidden = String(await ev(`
  (() => {
    const r = document.querySelector('.ribbon')
    return String(!r || getComputedStyle(r).display === 'none')
  })()
`))
rec('compact mode hides the ribbon', ribbonHidden === 'true')
await shot('31-compact')

// Compact mode hides the ribbon, so there must be a way out that is not in it.
const escapeHatch = String(await ev(`!!document.querySelector('.compact-view')`))
rec('compact mode leaves a visible way back to View', escapeHatch === 'true')

await clickText('.new-tab.compact-view', '\u2304')
await sleep(600)
const menuInCompact = Number(await ev(`document.querySelectorAll('.ctx-item').length`))
rec('View menu opens from the compact affordance', menuInCompact > 0, `${menuInCompact} items`)
await clickText('.ctx-item', 'Compact mode')
await sleep(700)
rec(
  'ribbon returns after leaving compact mode',
  String(await ev(`
    (() => {
      const r = document.querySelector('.ribbon')
      return String(!!r && getComputedStyle(r).display !== 'none')
    })()
  `)) === 'true'
)

// ---------- cleanup ----------
clearProof()
await clickText('.ribbon-btn', 'View')
await sleep(500)
await clickText('.ctx-item', 'Single terminal mode')
await sleep(600)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)

console.log('\n===== SPLIT / MULTIEXEC / VIEW =====')
for (const l of results) console.log(l)
const failed = results.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log('====================================\n')

ws.close()
process.exit(failed ? 1 : 0)
