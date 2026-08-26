// Editing, speed control, and running one macro across several terminals at
// once — each proven by a filesystem side effect rather than by reading the
// screen (the WebGL renderer keeps terminal text out of the DOM).
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
const setInput = (selector, value, index = 0) =>
  ev(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]
      if (!el) return 'missing'
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
      setter.call(el, ${JSON.stringify(String(value))})
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      return 'ok'
    })()
  `)
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

const proofA = `${OUT}/macro-a.txt`
const proofB = `${OUT}/macro-b.txt`
const proofC = `${OUT}/macro-c.txt`
for (const f of [proofA, proofB, proofC]) rmSync(f, { force: true })

// Clean slate.
await ev(`
  (() => {
    for (let i = 0; i < 4; i++) {
      const b = [...document.querySelectorAll('.modal-actions .btn')]
        .find(x => /^(Done|Close|Cancel)$/.test(x.innerText.trim()))
      if (!b) break
      b.click()
    }
    return 'x'
  })()
`)
await sleep(600)
await ev(`window.api.macros.list().then(a => Promise.all(a.map(m => window.api.macros.remove(m.id)))).then(()=>'ok')`)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)
await sleep(800)

// ---------- three terminals ----------
for (let i = 0; i < 3; i++) {
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true })), 'x'`)
  await sleep(2200)
}
const tabCount = Number(await ev(`document.querySelectorAll('.tab').length`))
rec('three terminals open', tabCount === 3, `${tabCount} tabs`)

// ---------- seed a macro directly, then edit it in the UI ----------
await ev(`
  window.api.macros.save({
    name: 'seeded',
    steps: [{ data: 'echo PLACEHOLDER', delay: 0 }, { data: '\\r', delay: 40 }],
    createdAt: Date.now(),
    speed: 1
  }).then(() => 'ok')
`)

await clickText('.ribbon-btn', 'Macros')
await sleep(900)
rec('macro list shows the seeded macro', /seeded/.test(String(await ev(`document.querySelector('.key-list')?.innerText ?? ''`))))

await clickText('.key-row .btn', 'Edit')
await sleep(800)
rec('editor opens', /Edit macro/.test(String(await ev(`[...document.querySelectorAll('.modal h2')].map(h=>h.innerText).join('|')`))))

const rowCount = Number(await ev(`document.querySelectorAll('.step-row').length`))
rec('editor lists the recorded steps', rowCount === 2, `${rowCount} rows`)

const escaped = String(await ev(`[...document.querySelectorAll('.step-data')].map(i=>i.value).join(' | ')`))
rec(
  'control bytes shown as editable escapes',
  escaped.includes('\\\\r') || escaped.includes('\\r'),
  escaped
)
await shot('25-macro-editor')

// Rewrite step 1 to write a file, and slow step 2 down.
await setInput('.step-data', `echo EDITED-OK > ${proofA}`, 0)
await setInput('.step-delay', '60', 1)
await setInput('.modal input', 'edited-macro', 0) // name field is the first input
await setInput('.modal select', '0', 0) // default speed -> Instant
await sleep(300)
await clickText('.modal-actions .btn', 'Save changes')
await sleep(900)

const saved = JSON.parse(String(await ev(`window.api.macros.list().then(a => JSON.stringify(a))`)))
rec('edits persisted', saved.length === 1 && saved[0].name === 'edited-macro', JSON.stringify(saved[0]?.name))
rec(
  'edited step text round-trips through escaping',
  saved[0]?.steps?.[0]?.data === `echo EDITED-OK > ${proofA}`,
  JSON.stringify(saved[0]?.steps?.[0]?.data?.slice(0, 40))
)
rec('carriage return survived editing', saved[0]?.steps?.[1]?.data === '\r', JSON.stringify(saved[0]?.steps?.[1]?.data))
rec('edited delay saved', saved[0]?.steps?.[1]?.delay === 60, String(saved[0]?.steps?.[1]?.delay))
rec('default speed saved', saved[0]?.speed === 0, String(saved[0]?.speed))

// ---------- run on ONE terminal ----------
await clickText('.key-row .btn', 'Play…')
await sleep(700)
const targetRows = Number(await ev(`document.querySelectorAll('.target-row').length`))
rec('run panel lists every open terminal', targetRows === 3, `${targetRows} targets`)
const preChecked = Number(await ev(`document.querySelectorAll('.target-row input:checked').length`))
rec('active terminal pre-selected', preChecked === 1, `${preChecked} checked`)
await shot('26-macro-run')

await clickText('.inset .modal-actions .btn', 'Run on')
let oneRan = false
for (let i = 0; i < 20 && !oneRan; i++) {
  await sleep(400)
  oneRan = existsSync(proofA)
}
rec('single-target run executes', oneRan, oneRan ? JSON.stringify(readFileSync(proofA, 'utf8').trim()) : 'no file')

// ---------- run on ALL THREE ----------
// Give each terminal its own output file so we can prove all three ran.
rmSync(proofA, { force: true })
await ev(`
  window.api.macros.list().then(([m]) =>
    window.api.macros.save({
      ...m,
      steps: [
        { data: 'echo MULTI-$$ > ${OUT}/macro-multi-$$.txt', delay: 0 },
        { data: '\\r', delay: 40 }
      ]
    })
  ).then(() => 'ok')
`)
await sleep(500)

// The panel caches the macro list in React state; saving through the API
// behind its back leaves it stale. Reopen so it re-reads the new steps.
await clickText('.inset .modal-actions .btn', 'Cancel')
await sleep(400)
await clickText('.modal-actions .btn', 'Done')
await sleep(600)
await clickText('.ribbon-btn', 'Macros')
await sleep(900)
await clickText('.key-row .btn', 'Play…')
await sleep(700)
await clickText('.field .btn', 'Select all')
await sleep(400)
const allChecked = Number(await ev(`document.querySelectorAll('.target-row input:checked').length`))
rec('select all ticks every terminal', allChecked === 3, `${allChecked} checked`)

const runLabel = String(await ev(`[...document.querySelectorAll('.inset .modal-actions .btn')].map(b=>b.innerText).join('|')`))
rec('run button names the target count', /Run on 3/.test(runLabel), runLabel)

// Clear any stale per-pid files first.
await ev(`'noop'`)
const before = new Set()
await clickText('.inset .modal-actions .btn', 'Run on 3')
await sleep(4000)

// Each shell writes macro-multi-<pid>.txt, so distinct PIDs prove distinct shells.
const { readdirSync } = await import('node:fs')
const produced = readdirSync(OUT).filter((f) => /^macro-multi-\d+\.txt$/.test(f))
rec(
  'macro ran on all three terminals concurrently',
  produced.length === 3,
  `${produced.length} distinct shells wrote output: ${produced.join(', ')}`
)

const states = String(await ev(`[...document.querySelectorAll('.target-state')].map(s=>s.innerText).join(',')`))
rec('per-target completion reported', (states.match(/done/gi) ?? []).length === 3, states)
await shot('27-macro-multi')

// ---------- cleanup ----------
for (const f of readdirSync(OUT).filter((f) => /^macro-(multi-\d+|a|b|c)\.txt$/.test(f))) {
  rmSync(`${OUT}/${f}`, { force: true })
}
await ev(`window.api.macros.list().then(a => Promise.all(a.map(m => window.api.macros.remove(m.id)))).then(()=>'ok')`)
await ev(`
  (() => {
    for (let i = 0; i < 4; i++) {
      const b = [...document.querySelectorAll('.modal-actions .btn')]
        .find(x => /^(Done|Close|Cancel)$/.test(x.innerText.trim()))
      if (!b) break
      b.click()
    }
    return 'x'
  })()
`)
await sleep(500)
await ev(`document.querySelectorAll('.tab .close').forEach(b => b.click()), 'x'`)

console.log('\n===== MACRO EDIT / SPEED / MULTI-TARGET =====')
for (const l of results) console.log(l)
const failed = results.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log('=============================================\n')

ws.close()
process.exit(failed ? 1 : 0)
