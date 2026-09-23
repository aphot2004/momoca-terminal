// Selecting several files and folders in the SFTP pane, and what the download
// and delete paths then offer to do with them.
//
// Clicks are real clicks at real coordinates, and every target is checked for
// reachability first — a test that reaches past a scrim proves nothing about
// the UI. What actually crosses the wire is proved separately, on disk, by
// sftpselect.mjs; this suite stops at the native destination picker, which is
// the edge of what CDP can drive.
//
//   node test/sshd.mjs        # in another shell
//   Electron . --remote-debugging-port=9222
//   node test/suites/sftpui.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = resolve(here, '..', '.artifacts')
const FIXTURE = 'sftpui-fixture'
const FIXTURE_DIR = resolve(ARTIFACTS, 'served', FIXTURE)
/** Named so cleanup can find its own and never touch a real saved session. */
const SESSION_NAME = 'sftpui-test-session'

// --- fixture ----------------------------------------------------------------
// Named so the listing order is known: folders first, then files, each A-Z.
rmSync(FIXTURE_DIR, { recursive: true, force: true })
for (const relative of [
  'dir-a/one.txt',
  'dir-b/two.txt',
  'dir-c/three.txt',
  'file-1.txt',
  'file-2.log',
  'file-3.txt'
]) {
  const full = resolve(FIXTURE_DIR, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, `${relative}\n`)
}

// --- cdp --------------------------------------------------------------------

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
let n = 0
const waiting = new Map()
let lastDialog = null
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Page.javascriptDialogOpening') lastDialog = m.params.message
  const r = waiting.get(m.id)
  if (r) {
    waiting.delete(m.id)
    r(m)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++n
    waiting.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) {
    return `__ERR__ ${r.result.exceptionDetails.exception?.description?.split('\n')[0]}`
  }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => ws.addEventListener('open', r))
await send('Page.enable')

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

/**
 * Locate an element by its text (or a selector), and assert a real click at its
 * centre would actually land on it before returning where to click.
 */
const locate = async (selector, text = null) => {
  const raw = await ev(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const want = ${text === null ? 'null' : JSON.stringify(text)};
    const hit = want === null ? all[0] : all.find((e) => (e.textContent || '').trim() === want);
    if (!hit) return JSON.stringify({ found: false });
    const r = hit.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return JSON.stringify({ found: true, x, y, reachable: hit === top || hit.contains(top) });
  })()`)
  return JSON.parse(raw)
}

const clickAt = async (x, y, modifiers = 0) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers })
  await sleep(180)
}
const click = async (selector, text = null, modifiers = 0) => {
  const spot = await locate(selector, text)
  if (!spot.found || !spot.reachable) return false
  await clickAt(spot.x, spot.y, modifiers)
  return true
}
const META = 4
const SHIFT = 8

// --- clean slate ------------------------------------------------------------
// View settings and saved sessions persist between runs, so start by putting
// the app back where this suite expects it, touching only its own fixtures.
await ev(`(async () => {
  for (const s of await window.api.sessions.list()) {
    if (s.name === ${JSON.stringify(SESSION_NAME)}) await window.api.sessions.delete(s.id)
  }
})()`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })

// Build the session through the dialog, the way a person would: the SFTP pane
// needs a live channel before there is anything to select, and driving the real
// path means the setup fails loudly if the dialog ever breaks.
const typeInto = async (selector, index, text) => {
  const spot = await ev(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return JSON.stringify({ x, y, reachable: el === top });
  })()`)
  if (!spot) return false
  const { x, y, reachable } = JSON.parse(spot)
  if (!reachable) return false
  // Triple-click selects whatever is there, so typing replaces it.
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 3 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 3 })
  await sleep(120)
  await send('Input.insertText', { text })
  await sleep(120)
  return true
}

await click('.sidebar-actions .btn', 'New Session')
await sleep(500)
await click('.type-tile, .session-type', 'SSH')
await sleep(400)
rec('the session dialog is open', Boolean(await ev(`!!document.querySelector('.modal')`)))

const fields = await ev(`[...document.querySelectorAll('.modal .field label')].map(l => l.textContent.trim()).join(' | ')`)
rec('the dialog offers the fields this suite fills', String(fields).includes('Host'), String(fields))

// Fill by the label above each input rather than by position, so a reordered
// dialog fails the test instead of silently filling the wrong box.
const fillLabelled = async (labelText, text) => {
  const spot = await ev(`(() => {
    const field = [...document.querySelectorAll('.modal .field, .modal .field-row .field')]
      .find(f => (f.querySelector('label')||{}).textContent?.trim().startsWith(${JSON.stringify(labelText)}));
    const el = field && field.querySelector('input');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return JSON.stringify({ x, y, reachable: el === document.elementFromPoint(x, y) });
  })()`)
  if (!spot) return false
  const { x, y, reachable } = JSON.parse(spot)
  if (!reachable) return false
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 3 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 3 })
  await sleep(100)
  await send('Input.insertText', { text })
  await sleep(100)
  return true
}

rec('name field filled', await fillLabelled('Name', SESSION_NAME))
rec('host field filled', await fillLabelled('Host', '127.0.0.1'))
rec('port field filled', await fillLabelled('Port', '2222'))
rec('username field filled', await fillLabelled('Username', 'tester'))

// A native <select> opens an OS menu a CDP click cannot drive, so this one
// control is set through the DOM. Everything else here is a real click.
await ev(`(() => {
  const sel = [...document.querySelectorAll('.modal select')].find(s => [...s.options].some(o => o.value === 'key'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'key');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 1 })()`)
await sleep(400)
rec('choosing a private key reveals the key file field', Boolean(await ev(`
  [...document.querySelectorAll('.modal .field label')].some(l => l.textContent.trim() === 'Key file')`)))
rec('key file filled', await fillLabelled('Key file', resolve(ARTIFACTS, 'testkey')))

await click('.modal-actions .btn', 'Save')
await sleep(800)
rec('the session is saved and listed', Boolean(await ev(`
  [...document.querySelectorAll('.session-tree *')].some(e => (e.textContent||'').trim() === ${JSON.stringify(SESSION_NAME)})`)))

// Open it: a saved session opens on double-click, as in every file list.
const row = await ev(`(() => {
  const hit = [...document.querySelectorAll('.session-tree *')]
    .filter(e => (e.textContent || '').trim() === ${JSON.stringify(SESSION_NAME)} && e.children.length <= 1).pop();
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return JSON.stringify({ x, y, reachable: hit === top || hit.contains(top) });
})()`)
rec('the saved session row is reachable', Boolean(row) && JSON.parse(row).reachable)
if (row) {
  // A session row opens on a single click; clicking twice opens two tabs.
  const { x, y } = JSON.parse(row)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

// First contact with the throwaway server is an unknown host. Trust it here and
// take the line back out of known_hosts at the end — by host, never wholesale.
await sleep(1800)
const hostKeyPrompt = await ev(`(() => {
  const h = [...document.querySelectorAll('.modal h2')].find(e => e.textContent.trim() === 'Unknown host');
  if (!h) return null;
  const btn = [...h.closest('.modal').querySelectorAll('button')].find(b => b.textContent.trim() === 'Trust and connect');
  const r = btn.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  return JSON.stringify({ x, y, reachable: btn === document.elementFromPoint(x, y) });
})()`)
if (hostKeyPrompt) {
  const { x, y, reachable } = JSON.parse(hostKeyPrompt)
  rec('the unknown-host prompt is reachable', reachable)
  await clickAt(x, y)
}
await sleep(3500)
rec('the test session connects', Boolean(await ev(`document.querySelectorAll('.tab').length`)), `${await ev(`document.querySelectorAll('.tab').length`)} tab(s)`)

// --- open the file pane -----------------------------------------------------

if (!(await ev(`!!document.querySelector('.filepane')`))) {
  await click('button[title^="SFTP"], .panel-tab', 'SFTP')
}
if (!(await ev(`!!document.querySelector('.filepane')`))) {
  const spot = await locate('button[title="SFTP is available on SSH sessions only"], button')
  if (spot.found) await clickAt(spot.x, spot.y)
}
await sleep(1200)
rec('the SFTP pane is showing', Boolean(await ev(`!!document.querySelector('.filepane')`)))

// Navigate to the fixture via the path bar, the way a person types a path.
await ev(`(() => { const i = document.querySelector('.filepane-pathbar input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(FIXTURE_DIR)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.form.requestSubmit(); return 1 })()`)
await sleep(1500)

const names = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.filepane-list .file-row')].map(r => (r.querySelector('.fname')||{}).textContent))`))
const listed = await names()
rec('the fixture directory lists', listed.join() === ['..', 'dir-a', 'dir-b', 'dir-c', 'file-1.txt', 'file-2.log', 'file-3.txt'].join(), listed.join(' '))

const rowSpot = async (name) => {
  const raw = await ev(`(() => {
    const hit = [...document.querySelectorAll('.filepane-list .file-row')]
      .find(r => ((r.querySelector('.fname')||{}).textContent || '') === ${JSON.stringify(name)});
    if (!hit) return JSON.stringify({ found: false });
    const r = hit.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return JSON.stringify({ found: true, x, y, reachable: hit === top || hit.contains(top) });
  })()`)
  return JSON.parse(raw)
}
const clickRow = async (name, modifiers = 0) => {
  const spot = await rowSpot(name)
  if (!spot.found || !spot.reachable) return false
  await clickAt(spot.x, spot.y, modifiers)
  return true
}
const selected = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.filepane-list .file-row.selected')].map(r => (r.querySelector('.fname')||{}).textContent))`))

// --- selection --------------------------------------------------------------

rec('a row is reachable to click', (await rowSpot('dir-a')).reachable)

await clickRow('dir-a')
rec('a plain click selects one', (await selected()).join() === 'dir-a', (await selected()).join(' '))

await clickRow('file-1.txt', META)
rec('⌘-click adds to the selection', (await selected()).join() === 'dir-a,file-1.txt', (await selected()).join(' '))

await clickRow('file-1.txt', META)
rec('⌘-click again takes it back out', (await selected()).join() === 'dir-a', (await selected()).join(' '))

await clickRow('dir-a')
await clickRow('file-1.txt', SHIFT)
rec(
  'Shift-click takes the range between',
  (await selected()).join() === 'dir-a,dir-b,dir-c,file-1.txt',
  (await selected()).join(' ')
)

rec('the header reports the count', (await ev(`(document.querySelector('.filepane-header .col-selected')||{}).textContent`)) === '4 selected',
  String(await ev(`(document.querySelector('.filepane-header .col-selected')||{}).textContent`)))

await clickRow('file-3.txt')
rec('a plain click clears the rest', (await selected()).join() === 'file-3.txt', (await selected()).join(' '))

// --- the download dialog ----------------------------------------------------

await clickRow('dir-a')
await clickRow('file-2.log', META)
await clickRow('dir-c', META)

const downloadBtn = await locate('.filepane-toolbar .icon-btn:nth-of-type(2)')
rec('the download button is reachable', downloadBtn.reachable)
await clickAt(downloadBtn.x, downloadBtn.y)
await sleep(400)

rec('the download dialog opens for a multi-selection', Boolean(await ev(`!!document.querySelector('.download-manifest')`)))
const heading = await ev(`(document.querySelector('.modal h2')||{}).textContent`)
rec('the heading counts folders and files apart', heading === 'Download 2 folders and 1 file', String(heading))
const manifest = await ev(`[...document.querySelectorAll('.download-item')].map(d => d.textContent).join(' | ')`)
rec('the manifest names what is coming', String(manifest).includes('dir-a') && String(manifest).includes('file-2.log') && String(manifest).includes('dir-c'), String(manifest))
rec('a folder is marked as recursive in the manifest', String(manifest).includes('and everything inside'), String(manifest))

// Presets write into the field, and do not double up.
await ev(`(() => { const t = document.querySelector('#sftp-excludes');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return 1 })()`)
await sleep(120)
await click('.preset-row .btn.preset', 'node_modules/')
await click('.preset-row .btn.preset', '*.log')
await click('.preset-row .btn.preset', 'node_modules/')
const patterns = await ev(`document.querySelector('#sftp-excludes').value`)
rec('presets add a pattern, and only once', patterns === 'node_modules/\n*.log', JSON.stringify(patterns))

// Cancel leaves everything as it was.
await click('.modal-actions .btn', 'Cancel')
await sleep(250)
rec('cancel closes the dialog', !(await ev(`!!document.querySelector('.download-manifest')`)))
rec('cancel keeps the selection', (await selected()).join() === 'dir-a,dir-c,file-2.log', (await selected()).join(' '))

// A single file skips the dialog and goes straight to Save As.
await clickRow('file-1.txt')
rec('one plain file is selected', (await selected()).join() === 'file-1.txt')

// --- the delete confirmation ------------------------------------------------

await clickRow('dir-a')
await clickRow('dir-b', META)
lastDialog = null
const deleteBtn = await locate('.filepane-toolbar .icon-btn:last-of-type')
rec('the delete button is reachable', deleteBtn.reachable)
await clickAt(deleteBtn.x, deleteBtn.y)
await sleep(900)
await send('Page.handleJavaScriptDialog', { accept: false })
await sleep(300)
rec(
  'deleting a selection asks about all of it, and counts what is inside',
  String(lastDialog).includes('Delete 2 items') && /4 entries in total/.test(String(lastDialog)),
  JSON.stringify(lastDialog)
)
rec('a declined delete leaves the folders alone', (await names()).includes('dir-a') && (await names()).includes('dir-b'), (await names()).join(' '))

// --- the context menu -------------------------------------------------------

const ctx = await rowSpot('dir-a')
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctx.x, y: ctx.y, button: 'right', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctx.x, y: ctx.y, button: 'right', clickCount: 1 })
await sleep(350)
const items = await ev(`[...document.querySelectorAll('.context-menu button, .menu-row, [role=menuitem]')].map(e => e.textContent.trim()).join(' | ')`)
rec('right-clicking inside a selection offers to act on all of it', String(items).includes('Download 2 items') && String(items).includes('Delete 2 items'), String(items).slice(0, 120))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(250)

const single = await rowSpot('file-3.txt')
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: single.x, y: single.y, button: 'right', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: single.x, y: single.y, button: 'right', clickCount: 1 })
await sleep(350)
const oneItems = await ev(`[...document.querySelectorAll('.context-menu button, .menu-row, [role=menuitem]')].map(e => e.textContent.trim()).join(' | ')`)
rec(
  'right-clicking outside a selection acts on that row alone',
  String(oneItems).includes('Rename…') && !String(oneItems).includes('items'),
  String(oneItems).slice(0, 120)
)
rec('right-clicking outside a selection reselects it', (await selected()).join() === 'file-3.txt', (await selected()).join(' '))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(250)

// --- select all -------------------------------------------------------------

await clickRow('dir-a')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: META })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: META })
await sleep(300)
rec('⌘A takes the whole listing', (await selected()).length === 6, (await selected()).join(' '))

// --- cleanup ----------------------------------------------------------------
// By name only: the store on this machine holds real saved sessions.

await ev(`(async () => {
  for (const s of await window.api.sessions.list()) {
    if (s.name === ${JSON.stringify(SESSION_NAME)}) await window.api.sessions.delete(s.id)
  }
})()`)
rmSync(FIXTURE_DIR, { recursive: true, force: true })

// Only this host's line. The file on this machine holds real hosts, and the
// user adds more between runs — a wholesale restore would eat them.
try {
  const knownHosts = resolve(process.env.HOME, '.ssh', 'known_hosts')
  const before = readFileSync(knownHosts, 'utf8')
  const after = before
    .split('\n')
    .filter((line) => !line.startsWith('[127.0.0.1]:2222 '))
    .join('\n')
  if (after !== before) writeFileSync(knownHosts, after)
} catch {
  /* no known_hosts, or nothing of ours in it */
}

console.log('\n===== SFTP SELECTION (UI) =====')
for (const line of results) console.log(line)
const passed = results.filter((r) => r.startsWith('PASS')).length
console.log(`\n${passed}/${results.length} passed`)
console.log('===============================')
process.exit(passed === results.length ? 0 : 1)
