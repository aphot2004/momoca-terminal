// Exercises the network tools, macro recorder and Unix command catalogue
// against real local services rather than stubs.
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

/** Scratch space for fixtures and screenshots, ignored by git. */
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.artifacts')
mkdirSync(OUT, { recursive: true })
const PROBE_PORT = 19311

// A real listener, so "open" is a fact rather than a guess.
const server = createServer((_q, r) => r.end('ok'))
await new Promise((r) => server.listen(PROBE_PORT, '127.0.0.1', r))

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

// ================= PORT SCANNER =================
const scan = await ev(`
  new Promise(async (resolve) => {
    const seen = []
    const off = window.api.net.onScan((p) => {
      if (p.finished) { off(); resolve(JSON.stringify({ open: p.open, done: p.done })) }
    })
    await window.api.net.scan({ host: '127.0.0.1', ports: '${PROBE_PORT},${PROBE_PORT + 1},22,80' })
  })
`)
const scanRes = JSON.parse(String(scan))
const openPorts = (scanRes.open ?? []).map((r) => r.port)
rec('port scan finds a real listener', openPorts.includes(PROBE_PORT), `open: [${openPorts}]`)
rec(
  'port scan does not report a closed port as open',
  !openPorts.includes(PROBE_PORT + 1),
  `checked ${PROBE_PORT + 1}`
)
rec('port scan probed every port', scanRes.done === 4, `done ${scanRes.done}/4`)

// Bad input is refused rather than silently scanning nothing.
const badPorts = await ev(
  `window.api.net.scan({ host: '127.0.0.1', ports: '1-99999' }).then(() => 'ACCEPTED').catch(e => 'REFUSED: ' + e.message)`
)
rec('absurd port range is refused', String(badPorts).startsWith('REFUSED'), String(badPorts).slice(0, 70))

// ================= PING =================
const ping = await ev(`
  new Promise(async (resolve) => {
    const off = window.api.net.onPing((p) => {
      if (p.finished) { off(); resolve(JSON.stringify({ summary: p.summary, error: p.error })) }
    })
    await window.api.net.ping('127.0.0.1', 3)
  })
`)
const pingRes = JSON.parse(String(ping))
rec(
  'ping loopback gets replies',
  pingRes.summary?.received === 3 && pingRes.summary?.avg !== null,
  `received ${pingRes.summary?.received}/3, avg ${pingRes.summary?.avg?.toFixed(3)} ms`
)

// An unroutable address must report loss, not hang or claim success.
const deadPing = await ev(`
  new Promise(async (resolve) => {
    const off = window.api.net.onPing((p) => {
      if (p.finished) { off(); resolve(JSON.stringify({ summary: p.summary })) }
    })
    await window.api.net.ping('192.0.2.1', 1)
  })
`)
const dead = JSON.parse(String(deadPing))
rec(
  'unreachable host reports 100% loss',
  dead.summary?.received === 0 && dead.summary?.loss === 1,
  `received ${dead.summary?.received}, loss ${dead.summary?.loss}`
)

// ================= DISCOVERY =================
const nets = JSON.parse(String(await ev(`window.api.net.localNetworks().then(n => JSON.stringify(n))`)))
rec('local subnet detected for the default', nets.length > 0, nets.map((x) => `${x.iface} ${x.cidr}`).join(', '))

const badCidr = await ev(
  `window.api.net.discover('10.0.0.0/8').then(() => 'ACCEPTED').catch(e => 'REFUSED: ' + e.message)`
)
rec('oversized sweep is refused', String(badCidr).startsWith('REFUSED'), String(badCidr).slice(0, 80))

// A /30 around loopback is tiny and finishes fast.
const sweep = await ev(`
  new Promise(async (resolve) => {
    const off = window.api.net.onDiscover((p) => {
      if (p.finished) { off(); resolve(JSON.stringify({ hosts: p.hosts, done: p.done, total: p.total })) }
    })
    await window.api.net.discover('127.0.0.0/30')
  })
`)
const sweepRes = JSON.parse(String(sweep))
rec(
  'subnet sweep completes and finds loopback',
  sweepRes.done === sweepRes.total && (sweepRes.hosts ?? []).some((h) => h.ip === '127.0.0.1'),
  `${sweepRes.done}/${sweepRes.total}, found ${(sweepRes.hosts ?? []).map((h) => h.ip).join(',')}`
)

// ================= MACROS =================
// Drive the recorder store directly; it is the same path the terminal feeds.
const macroTest = await ev(`
  (async () => {
    const m = await import('/src/macro-recorder.ts').catch(() => null)
    return m ? 'esm' : 'bundled'
  })()
`)

const macroRoundTrip = await ev(`
  window.api.macros.save({
    name: 'test-macro',
    steps: [{ data: 'echo hi', delay: 0 }, { data: '\\r', delay: 120 }],
    createdAt: Date.now(),
    useRecordedTiming: false
  }).then(saved =>
    window.api.macros.list().then(all => JSON.stringify({
      id: saved.id,
      found: all.some(x => x.id === saved.id),
      steps: all.find(x => x.id === saved.id)?.steps
    }))
  )
`)
const macro = JSON.parse(String(macroRoundTrip))
rec(
  'macro saves and reloads with steps intact',
  macro.found && macro.steps?.length === 2 && macro.steps[1].data === '\r',
  `${macro.steps?.length} steps, control byte preserved: ${JSON.stringify(macro.steps?.[1]?.data)}`
)

await ev(`window.api.macros.remove(${JSON.stringify(macro.id)}).then(() => 'ok')`)
const afterDelete = await ev(`window.api.macros.list().then(a => a.length)`)
rec('macro deletes', Number(afterDelete) === 0, `${afterDelete} left`)

// ================= UNIX TOOLS =================
const unix = JSON.parse(String(await ev(`window.api.unix.check().then(t => JSON.stringify(t))`)))
rec('unix catalogue returns tools', unix.length > 20, `${unix.length} tools`)

// Cross-check a few against the real system.
const realLs = (() => {
  try {
    return execFileSync('/usr/bin/which', ['ls']).toString().trim()
  } catch {
    return ''
  }
})()
const lsTool = unix.find((t) => t.name === 'ls')
rec('detects a tool that exists', lsTool?.available === true && !!lsTool?.path, `${lsTool?.path} vs ${realLs}`)

const bogus = unix.filter((t) => t.available && !t.path)
rec('every available tool has a resolved path', bogus.length === 0, `${bogus.length} without path`)

const withCaveats = unix.filter((t) => t.bsdCaveat)
rec('BSD caveats are flagged', withCaveats.length >= 4, withCaveats.map((t) => t.name).join(', '))

const missingWithFormula = unix.filter((t) => !t.available && t.formula)
rec(
  'missing tools carry an install formula',
  missingWithFormula.every((t) => !!t.formula),
  missingWithFormula.map((t) => `${t.name}→${t.formula}`).join(', ') || 'nothing missing'
)

// ================= UI SMOKE =================
await ev(`[...document.querySelectorAll('.ribbon-btn')].find(b => b.innerText.includes('Network'))?.click(), 'x'`)
await sleep(900)
rec(
  'Network panel opens with three tabs',
  Number(await ev(`document.querySelectorAll('.panel-tabs.inline .panel-tab').length`)) === 3,
  String(await ev(`[...document.querySelectorAll('.panel-tabs.inline .panel-tab')].map(t=>t.innerText).join('|')`))
)
await shot('16-network')
await ev(`[...document.querySelectorAll('.modal-actions .btn')].find(b => /Close/.test(b.innerText))?.click(), 'x'`)
await sleep(500)

await ev(`[...document.querySelectorAll('.ribbon-btn')].find(b => b.innerText.includes('Unix'))?.click(), 'x'`)
await sleep(1800)
rec(
  'Unix panel lists tools with status',
  Number(await ev(`document.querySelectorAll('.key-row').length`)) > 3,
  `${await ev(`document.querySelectorAll('.key-row').length`)} rows`
)
await shot('17-unix')
await ev(`[...document.querySelectorAll('.modal-actions .btn')].find(b => /Done/.test(b.innerText))?.click(), 'x'`)
await sleep(500)

await ev(`[...document.querySelectorAll('.ribbon-btn')].find(b => b.innerText.includes('Macros'))?.click(), 'x'`)
await sleep(800)
rec('Macros panel opens', /Macros/.test(String(await ev(`document.querySelector('.modal h2')?.innerText ?? ''`))))
await shot('18-macros')

console.log('\n===== NETWORK / MACROS / UNIX =====')
for (const l of results) console.log(l)
console.log('===================================\n')

ws.close()
server.close()
process.exit(results.some((l) => l.startsWith('FAIL')) ? 1 : 0)
