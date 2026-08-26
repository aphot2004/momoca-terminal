// Drives the app the way a person does: real mouse events at real coordinates,
// real keystrokes, and — crucially — a reachability check before every click
// that asserts the target is the topmost element at its own centre.
//
// The previous macro test passed while the feature was unusable, because it
// called .focus() on the hidden xterm textarea and bypassed the modal scrim a
// human cannot bypass. This harness makes that class of bug impossible to miss.
import { writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'

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
await new Promise((r) => ws.addEventListener('open', r))

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

/**
 * Locate an element by visible text (or selector) and report whether a real
 * click at its centre would actually reach it.
 */
const probe = async (selector, text = null) => {
  const raw = await ev(`
    (() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = ${text === null ? 'all[0]' : `all.find(e => e.innerText && e.innerText.includes(${JSON.stringify(text)}))`}
      if (!el) return JSON.stringify({ found: false })
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return JSON.stringify({ found: true, visible: false })
      const x = Math.round(r.left + r.width / 2)
      const y = Math.round(r.top + r.height / 2)
      const top = document.elementFromPoint(x, y)
      const reachable = el === top || el.contains(top) || (top && top.contains(el))
      return JSON.stringify({
        found: true,
        visible: true,
        x, y,
        reachable,
        blockedBy: reachable ? null : (top ? (top.className || top.tagName) : 'nothing')
      })
    })()
  `)
  return JSON.parse(String(raw))
}

/** A real click: mouse pressed and released at the element's centre. */
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(200)
}

/** Click by visible text, failing loudly if a human couldn't reach it. */
const click = async (selector, text = null, label = null) => {
  const p = await probe(selector, text)
  const what = label ?? `${text ?? selector}`
  if (!p.found) {
    rec(`click "${what}"`, false, 'element not found')
    return false
  }
  if (!p.visible) {
    rec(`click "${what}"`, false, 'element has zero size')
    return false
  }
  if (!p.reachable) {
    rec(`click "${what}"`, false, `covered by .${p.blockedBy}`)
    return false
  }
  await clickAt(p.x, p.y)
  return true
}

const typeKeys = async (text) => {
  await send('Input.insertText', { text })
  await sleep(150)
}
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r'
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' })
  await sleep(200)
}

// Start clean. A modal left open by a previous run covers the ribbon and makes
// every later click fail, so dismiss anything on screen first.
await ev(`
  (() => {
    for (let i = 0; i < 4; i++) {
      const btn = [...document.querySelectorAll('.modal-actions .btn')]
        .find(b => /^(Done|Close|Cancel)$/.test(b.innerText.trim()))
      if (!btn) break
      btn.click()
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return 'cleared'
  })()
`)
await sleep(700)
await ev(`window.api.macros.list().then(a => Promise.all(a.map(m => window.api.macros.remove(m.id)))).then(()=>'ok')`)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)
await sleep(800)

// ===================================================================
// 1. MACRO RECORDING — the reported bug, done entirely by hand
// ===================================================================
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true })), 'x'`)
await sleep(2500)

await click('.ribbon-btn', 'Macros')
await sleep(800)

// Before the fix this Record button existed but recording was unusable after.
const recordOk = await click('.modal-actions .btn', 'Record')
rec('Record button is clickable', recordOk)
await sleep(700)

// The whole point: with recording on, is the terminal actually reachable?
const termProbe = await probe('.terminal-pane:not([hidden])')
rec(
  'terminal is clickable while recording (no modal scrim in the way)',
  termProbe.reachable === true,
  termProbe.reachable ? 'reachable' : `blocked by .${termProbe.blockedBy}`
)

const barProbe = await probe('.recording-bar')
rec('floating recording bar is shown', barProbe.found === true && barProbe.visible === true)
await shot('21-recording-bar')

// Click into the terminal like a person, then type.
if (termProbe.reachable) await clickAt(termProbe.x, termProbe.y)
await sleep(300)
const proof = `${OUT}/human-macro-proof.txt`
rmSync(proof, { force: true })
await typeKeys(`echo HUMAN-MACRO-OK > ${proof}`)
await pressEnter()
await sleep(700)

const barText = String(await ev(`document.querySelector('.recording-bar')?.innerText.replace(/\\n/g,' ') ?? ''`))
rec(
  'typing in the terminal is captured by the recorder',
  /[1-9]\d* step/.test(barText),
  barText.slice(0, 60)
)

// Save from the floating bar.
const savedOk = await click('.recording-bar .btn', 'Stop and save')
rec('Stop and save is clickable', savedOk)
await sleep(700)

const nameBox = await probe('.modal.narrow input')
rec('name dialog appears and is reachable', nameBox.reachable === true, nameBox.blockedBy ?? 'ok')
if (nameBox.reachable) {
  await clickAt(nameBox.x, nameBox.y)
  await typeKeys('human-macro')
  await sleep(200)
  await click('.modal.narrow .btn', 'Save')
}
await sleep(900)

const savedMacros = JSON.parse(String(await ev(`window.api.macros.list().then(a => JSON.stringify(a))`)))
rec('macro saved end to end by hand', savedMacros.length === 1, JSON.stringify(savedMacros[0]?.name))

// Replay it and confirm the shell really ran it.
rmSync(proof, { force: true })
// Saving reopens the Macros panel automatically so the new macro is visible;
// only click the ribbon if it somehow isn't already open.
const panelOpen = /Macros/.test(String(await ev(`document.querySelector('.modal h2')?.innerText ?? ''`)))
rec('macro panel reopens after saving', panelOpen)
if (!panelOpen) {
  await click('.ribbon-btn', 'Macros')
  await sleep(800)
}
// Play now opens a run panel (targets + speed) rather than firing immediately.
await click('.key-row .btn', 'Play…')
await sleep(700)
await click('.inset .modal-actions .btn', 'Run on')
let replayed = false
for (let i = 0; i < 20 && !replayed; i++) {
  await sleep(400)
  replayed = existsSync(proof)
}
rec(
  'replay re-runs the command',
  replayed,
  replayed ? JSON.stringify(readFileSync(proof, 'utf8').trim()) : 'file never appeared'
)
await click('.modal-actions .btn', 'Done')
await sleep(500)

// ===================================================================
// 2. REACHABILITY AUDIT — every panel's primary controls
// ===================================================================
const audit = async (openLabel, closeLabel, checks) => {
  await click('.ribbon-btn', openLabel)
  await sleep(1200)
  for (const [selector, text, label] of checks) {
    const p = await probe(selector, text)
    rec(
      `${openLabel}: "${label ?? text ?? selector}" reachable`,
      p.found && p.visible && p.reachable,
      !p.found ? 'not found' : !p.visible ? 'zero size' : p.reachable ? 'ok' : `blocked by .${p.blockedBy}`
    )
  }
  await click('.modal-actions .btn', closeLabel)
  await sleep(600)
}

await audit('Network', 'Close', [
  ['.panel-tab', 'Ping', 'Ping tab'],
  ['.panel-tab', 'Port scan', 'Port scan tab'],
  ['.panel-tab', 'Discover', 'Discover tab'],
  ['.modal .field input', null, 'host field'],
  ['.modal-actions .btn.primary', null, 'run button']
])

await audit('Unix', 'Done', [
  ['.panel-tab', 'Files', 'Files group'],
  ['.checkbox input', null, 'only-missing toggle'],
  ['.key-row .btn', null, 'first row action']
])

await audit('Keys', 'Done', [
  ['.modal-actions .btn', 'Import from file', 'import button'],
  ['.modal-actions .btn', 'Paste key', 'paste button']
])

await audit('Tunneling', 'Done', [['.modal-actions .btn', 'New tunnel', 'new tunnel button']])

await audit('Vault', 'Done', [['.modal-actions .btn', 'master password', 'set master password']])

await audit('Requirements', 'Done', [['.tool-head', null, 'first tool row']])

// Session dialog uses Cancel rather than Done.
await click('.ribbon-btn', 'Session')
await sleep(1000)
for (const [selector, text, label] of [
  ['.type-tile', 'SSH', 'SSH tile'],
  ['.modal .field input', null, 'name field'],
  ['.modal-actions .btn.primary', null, 'Save button']
]) {
  const p = await probe(selector, text)
  rec(
    `Session: "${label}" reachable`,
    p.found && p.visible && p.reachable,
    p.reachable ? 'ok' : `blocked by .${p.blockedBy ?? 'n/a'}`
  )
}
await click('.modal-actions .btn', 'Cancel')
await sleep(500)

// ===================================================================
// 3. Cleanup
// ===================================================================
rmSync(proof, { force: true })
await ev(`window.api.macros.list().then(a => Promise.all(a.map(m => window.api.macros.remove(m.id)))).then(()=>'ok')`)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)

console.log('\n===== HUMAN-STYLE UI AUDIT =====')
for (const l of results) console.log(l)
const failed = results.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log('================================\n')

ws.close()
process.exit(failed ? 1 : 0)
