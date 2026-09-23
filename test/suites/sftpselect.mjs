// Multi-item SFTP download and delete, and the exclusion patterns, against the
// throwaway server in test/sshd.mjs.
//
// This one talks to the operations directly rather than through the UI: what is
// worth proving here is what lands on disk and what is left on the server, and
// both are side effects the browser pane only relays. The selection behaviour
// on top of it is a click test — see the notes in CLAUDE.md.
//
//   node test/sshd.mjs        # in another shell
//   node test/suites/sftpselect.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countItems, downloadItems, removeItems } from '../../src/main/ssh/sftp-ops.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const require = createRequire(root + '/')
const { Client } = require('ssh2')

const ARTIFACTS = resolve(here, '..', '.artifacts')
const SERVED = resolve(ARTIFACTS, 'served')
/** The fixture lives under its own name so cleanup never touches anything else. */
const FIXTURE = 'sftpselect-fixture'
/*
 * Absolute, and the same path the server sees. The app never invents a remote
 * path either: it REALPATHs the directory it is showing and joins names onto
 * what comes back, so entries always carry the server's own absolute path.
 */
const REMOTE_ROOT = resolve(ARTIFACTS, 'served', FIXTURE)
const LOCAL_OUT = resolve(ARTIFACTS, 'sftpselect-out')

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

// --- fixture ---------------------------------------------------------------

const tree = {
  'keep.txt': 'keep',
  'notes.log': 'log at the top',
  'alpha/a1.txt': 'a1',
  'alpha/a2.log': 'a2 log',
  'alpha/node_modules/junk.txt': 'junk',
  'alpha/node_modules/deep/more-junk.txt': 'more junk',
  'alpha/nested/deep.txt': 'deep',
  'alpha/nested/keep.log': 'nested log',
  'beta/b1.txt': 'b1',
  'beta/build/out.bin': 'built',
  'gamma/g1.txt': 'g1'
}

function buildFixture() {
  rmSync(resolve(SERVED, FIXTURE), { recursive: true, force: true })
  for (const [relative, contents] of Object.entries(tree)) {
    const full = resolve(SERVED, FIXTURE, relative)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, `${contents}\n`)
  }
}

/** Every file under a local directory, as paths relative to it, sorted. */
function listLocal(dir) {
  const out = []
  const walk = (current, prefix) => {
    if (!existsSync(current)) return
    for (const entry of require('node:fs').readdirSync(current, { withFileTypes: true })) {
      const next = resolve(current, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(next, rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out.sort()
}

const entry = (name, type, size = 0) => ({
  name,
  path: `${REMOTE_ROOT}/${name}`,
  type,
  size,
  modified: 0,
  mode: type === 'directory' ? 0o040755 : 0o100644
})

// --- connect ---------------------------------------------------------------

const client = new Client()
const sftp = await new Promise((resolvePromise, reject) => {
  client.on('ready', () => client.sftp((err, channel) => (err ? reject(err) : resolvePromise(channel))))
  client.on('error', reject)
  client.connect({
    host: '127.0.0.1',
    port: 2222,
    username: 'tester',
    privateKey: readFileSync(resolve(ARTIFACTS, 'testkey'))
  })
})

// --- 1. one folder, no exclusions ------------------------------------------

buildFixture()
rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })

let outcome = await downloadItems(sftp, [entry('alpha', 'directory')], LOCAL_OUT, [])
let got = listLocal(LOCAL_OUT)
rec(
  'a folder comes down whole',
  got.join() ===
    [
      'alpha/a1.txt',
      'alpha/a2.log',
      'alpha/nested/deep.txt',
      'alpha/nested/keep.log',
      'alpha/node_modules/deep/more-junk.txt',
      'alpha/node_modules/junk.txt'
    ].join(),
  `${outcome.files} files: ${got.join(' ')}`
)

// --- 2. exclusions prune by name, at any depth ------------------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(sftp, [entry('alpha', 'directory')], LOCAL_OUT, ['node_modules/'])
got = listLocal(LOCAL_OUT)
rec(
  'an excluded folder is pruned, and so is everything under it',
  got.join() === ['alpha/a1.txt', 'alpha/a2.log', 'alpha/nested/deep.txt', 'alpha/nested/keep.log'].join(),
  got.join(' ')
)
rec('the pruned folder is reported once, not per file', outcome.excludedCount === 1, `excluded ${outcome.excludedCount}`)

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(sftp, [entry('alpha', 'directory')], LOCAL_OUT, ['*.log', 'node_modules/'])
got = listLocal(LOCAL_OUT)
rec(
  'a glob excludes matching files at every depth',
  got.join() === ['alpha/a1.txt', 'alpha/nested/deep.txt'].join(),
  got.join(' ')
)

// --- 3. a path pattern is anchored to where the file lands ------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(sftp, [entry('alpha', 'directory')], LOCAL_OUT, ['alpha/nested'])
got = listLocal(LOCAL_OUT)
rec(
  'a pattern with a slash matches the on-disk path only',
  got.join() ===
    ['alpha/a1.txt', 'alpha/a2.log', 'alpha/node_modules/deep/more-junk.txt', 'alpha/node_modules/junk.txt'].join(),
  got.join(' ')
)

// --- 4. a mixed selection, in one go ---------------------------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(
  sftp,
  [entry('keep.txt', 'file', 5), entry('notes.log', 'file', 15), entry('beta', 'directory'), entry('gamma', 'directory')],
  LOCAL_OUT,
  []
)
got = listLocal(LOCAL_OUT)
rec(
  'files and folders download together',
  got.join() === ['beta/b1.txt', 'beta/build/out.bin', 'gamma/g1.txt', 'keep.txt', 'notes.log'].join(),
  got.join(' ')
)
rec('the batch reports one total, not one per item', outcome.files === 5, `${outcome.files} files`)

// --- 5. exclusions apply to the selected items themselves -------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(
  sftp,
  [entry('keep.txt', 'file', 5), entry('notes.log', 'file', 15), entry('beta', 'directory')],
  LOCAL_OUT,
  ['*.log', 'build/']
)
got = listLocal(LOCAL_OUT)
rec(
  'a picked file matching an exclusion is dropped too',
  got.join() === ['beta/b1.txt', 'keep.txt'].join(),
  got.join(' ')
)

// --- 6. contents survive the trip ------------------------------------------

rec(
  'a downloaded file has the bytes the server had',
  readFileSync(resolve(LOCAL_OUT, 'keep.txt'), 'utf8') === 'keep\n',
  JSON.stringify(readFileSync(resolve(LOCAL_OUT, 'keep.txt'), 'utf8'))
)

// --- 7. counting a selection -----------------------------------------------

const total = await countItems(sftp, [entry('beta', 'directory'), entry('keep.txt', 'file', 5)])
// beta + b1.txt + build + out.bin + keep.txt
rec('a selection counts every entry it would delete', total === 5, `${total}`)

// --- 8. deleting a selection ------------------------------------------------

const removed = await removeItems(sftp, [entry('beta', 'directory'), entry('keep.txt', 'file', 5)])
rec('delete reports what it removed', removed.removed === 5, `${removed.removed}`)
rec(
  'the selection is gone from the server, and nothing else is',
  !existsSync(resolve(SERVED, FIXTURE, 'beta')) &&
    !existsSync(resolve(SERVED, FIXTURE, 'keep.txt')) &&
    existsSync(resolve(SERVED, FIXTURE, 'alpha', 'a1.txt')) &&
    existsSync(resolve(SERVED, FIXTURE, 'gamma', 'g1.txt')),
  listLocal(resolve(SERVED, FIXTURE)).join(' ')
)

// --- 9. an empty exclusion set excludes nothing ------------------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
outcome = await downloadItems(sftp, [entry('gamma', 'directory')], LOCAL_OUT, ['', '   ', '# comment'])
rec(
  'blank lines and comments are not patterns',
  listLocal(LOCAL_OUT).join() === ['gamma/g1.txt'].join(),
  listLocal(LOCAL_OUT).join(' ')
)

// --- report -----------------------------------------------------------------

rmSync(resolve(SERVED, FIXTURE), { recursive: true, force: true })
rmSync(LOCAL_OUT, { recursive: true, force: true })
client.end()

console.log('\n===== SFTP SELECTION / EXCLUSIONS =====')
for (const line of results) console.log(line)
const passed = results.filter((r) => r.startsWith('PASS')).length
console.log(`\n${passed}/${results.length} passed`)
console.log('=======================================')
process.exit(passed === results.length ? 0 : 1)
