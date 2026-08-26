// Verifies scrolling works the way a person would use it: a visible scrollbar
// with a draggable thumb, mouse wheel, keyboard scrollback keys, and the
// jump-to-bottom chip. Also checks every scrollable panel actually scrolls.
import { writeFileSync } from 'node:fs'

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
const key = async (k, mods = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, modifiers: mods })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, modifiers: mods })
  await sleep(350)
}
await new Promise((r) => ws.addEventListener('open', r))

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

const viewport = () =>
  ev(`(() => {
    const v = document.querySelector('.terminal-pane:not([hidden]) .xterm-viewport')
    if (!v) return JSON.stringify({ missing: true })
    return JSON.stringify({ top: Math.round(v.scrollTop), max: Math.round(v.scrollHeight - v.clientHeight) })
  })()`)

// ---------- fill a terminal with scrollback ----------
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)
await sleep(700)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true })), 'x'`)
await sleep(2500)
await ev(`document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')?.focus(), 'x'`)
await send('Input.insertText', { text: 'seq 1 500' })
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' })
await sleep(2500)

// ---------- 1. a real, visible scrollbar ----------
const bar = JSON.parse(String(await ev(`(() => {
  const v = document.querySelector('.terminal-pane:not([hidden]) .xterm-viewport')
  const cs = getComputedStyle(v)
  return JSON.stringify({
    gutter: v.offsetWidth - v.clientWidth,
    overflowY: cs.overflowY,
    scrollable: v.scrollHeight > v.clientHeight
  })
})()`)))
rec('terminal has scrollback to scroll', bar.scrollable === true)
rec(
  'scrollbar occupies real width (a draggable thumb exists)',
  bar.gutter >= 8,
  `gutter ${bar.gutter}px, was 0 before`
)

// ---------- 2. mouse wheel ----------
const box = JSON.parse(String(await ev(`(() => {
  const p = document.querySelector('.terminal-pane:not([hidden])')
  const r = p.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) })
})()`)))
const atBottom = JSON.parse(String(await viewport()))
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -600
})
await sleep(500)
const afterWheel = JSON.parse(String(await viewport()))
rec(
  'mouse wheel scrolls the terminal up',
  afterWheel.top < atBottom.top,
  `${atBottom.top} -> ${afterWheel.top}`
)

// ---------- 3. jump-to-bottom chip ----------
const chip = String(await ev(`document.querySelector('.jump-bottom')?.innerText ?? ''`))
rec('jump-to-bottom chip appears when scrolled up', /line/.test(chip), chip)
await shot('22-scrolled-up')

const chipBox = JSON.parse(String(await ev(`(() => {
  const b = document.querySelector('.jump-bottom')
  if (!b) return JSON.stringify({ missing: true })
  const r = b.getBoundingClientRect()
  const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2)
  const top = document.elementFromPoint(x, y)
  return JSON.stringify({ x, y, reachable: b === top || b.contains(top) })
})()`)))
rec('chip is clickable (not under anything)', chipBox.reachable === true)

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: chipBox.x, y: chipBox.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: chipBox.x, y: chipBox.y, button: 'left', clickCount: 1 })
await sleep(600)
const afterChip = JSON.parse(String(await viewport()))
rec('clicking the chip returns to the bottom', afterChip.top >= afterChip.max - 2, `${afterChip.top}/${afterChip.max}`)
rec('chip disappears at the bottom', String(await ev(`!document.querySelector('.jump-bottom')`)) === 'true')

// ---------- 4. keyboard scrollback ----------
await ev(`document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')?.focus(), 'x'`)
await sleep(200)

const SHIFT = 8
await key('PageUp', SHIFT)
const afterPgUp = JSON.parse(String(await viewport()))
rec('Shift+PageUp scrolls up', afterPgUp.top < afterChip.top, `${afterChip.top} -> ${afterPgUp.top}`)

await key('PageDown', SHIFT)
const afterPgDn = JSON.parse(String(await viewport()))
rec('Shift+PageDown scrolls back down', afterPgDn.top > afterPgUp.top, `${afterPgUp.top} -> ${afterPgDn.top}`)

await key('Home', SHIFT)
const afterHome = JSON.parse(String(await viewport()))
rec('Shift+Home jumps to the top', afterHome.top === 0, `top=${afterHome.top}`)

await key('End', SHIFT)
const afterEnd = JSON.parse(String(await viewport()))
rec('Shift+End jumps to the bottom', afterEnd.top >= afterEnd.max - 2, `${afterEnd.top}/${afterEnd.max}`)

// Scroll keys must not leak into the shell as stray input.
const leaked = String(await ev(`
  (() => {
    const t = document.querySelector('.terminal-pane:not([hidden]) textarea.xterm-helper-textarea')
    return t ? t.value : 'no textarea'
  })()
`))
rec('scroll keys are not sent to the shell', leaked === '' || leaked === 'no textarea', JSON.stringify(leaked.slice(0, 20)))

// ---------- 5. other scrollable panels ----------
const panels = [
  ['Unix', '.key-list', 'Done'],
  ['Requirements', '.key-list', 'Done']
]
for (const [ribbon, selector, closeLabel] of panels) {
  await ev(`[...document.querySelectorAll('.ribbon-btn')].find(b => b.innerText.includes(${JSON.stringify(ribbon)}))?.click(), 'x'`)
  await sleep(1600)
  const info = JSON.parse(String(await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return JSON.stringify({ missing: true })
    const before = el.scrollTop
    el.scrollTop = 9999
    const after = el.scrollTop
    el.scrollTop = before
    const cs = getComputedStyle(el)
    return JSON.stringify({
      scrollable: el.scrollHeight > el.clientHeight,
      moved: after > before,
      gutter: el.offsetWidth - el.clientWidth,
      oy: cs.overflowY
    })
  })()`)))
  rec(
    `${ribbon} list scrolls`,
    info.missing ? false : (!info.scrollable || info.moved),
    info.missing ? 'panel not found' : `scrollable=${info.scrollable} moved=${info.moved} gutter=${info.gutter}px`
  )
  await ev(`[...document.querySelectorAll('.modal-actions .btn')].find(b => b.innerText.includes(${JSON.stringify(closeLabel)}))?.click(), 'x'`)
  await sleep(600)
}

// ---------- 6. ribbon survives a narrow window ----------
const originalWidth = Number(await ev(`window.innerWidth`))
await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 0, mobile: false })
await sleep(700)
const ribbon = JSON.parse(String(await ev(`(() => {
  const r = document.querySelector('.ribbon')
  const before = r.scrollLeft
  r.scrollLeft = 9999
  const moved = r.scrollLeft > before
  r.scrollLeft = before
  return JSON.stringify({ overflows: r.scrollWidth > r.clientWidth, moved, ox: getComputedStyle(r).overflowX })
})()`)))
rec(
  'ribbon scrolls horizontally when the window is narrow',
  !ribbon.overflows || ribbon.moved,
  `overflows=${ribbon.overflows} scrolls=${ribbon.moved} overflow-x=${ribbon.ox}`
)
await shot('23-narrow-ribbon')
await send('Emulation.clearDeviceMetricsOverride')
await sleep(500)
rec('window restored', Number(await ev(`window.innerWidth`)) === originalWidth)

await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)

console.log('\n===== SCROLLING =====')
for (const l of results) console.log(l)
const failed = results.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log('=====================\n')

ws.close()
process.exit(failed ? 1 : 0)
