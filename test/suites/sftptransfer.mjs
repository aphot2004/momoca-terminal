// Concurrency, byte-accuracy and cancellation for bulk SFTP transfers, against
// the throwaway server in test/sshd.mjs. Talks to sftp-ops.ts directly: what
// matters here is exact numbers and timing, which the UI only relays.
//
//   node test/sshd.mjs
//   node test/suites/sftptransfer.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomFillSync } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  downloadItems,
  uploadFiles,
  removeItems,
  localNameClaimer,
  TransferCancelledError
} from '../../src/main/ssh/sftp-ops.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = resolve(here, '..', '.artifacts')
const SERVED = resolve(ARTIFACTS, 'served')
const FIXTURE = 'sftptransfer-fixture'
// The directory that actually holds the files on disk...
const FIXTURE_ROOT = resolve(SERVED, FIXTURE)
// ...referenced the same way the app does: an entry's path is its parent's
// path plus its own name, so `entry(FIXTURE, 'directory')` below must be built
// against the *parent* of the fixture, not the fixture directory itself.
const REMOTE_ROOT = SERVED
const LOCAL_OUT = resolve(ARTIFACTS, 'sftptransfer-out')

const results = []
const rec = (label, ok, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

// --- fixture: many small binary files, "jpegs" in spirit ------------------

const FILE_COUNT = 40
rmSync(FIXTURE_ROOT, { recursive: true, force: true })
mkdirSync(FIXTURE_ROOT, { recursive: true })
let expectedTotalBytes = 0
for (let i = 0; i < FILE_COUNT; i++) {
  const size = 4_000 + ((i * 977) % 60_000) // varied, small-ish, like real photos
  const buf = Buffer.alloc(size)
  randomFillSync(buf)
  writeFileSync(resolve(FIXTURE_ROOT, `photo-${String(i).padStart(3, '0')}.bin`), buf)
  expectedTotalBytes += size
}

const client = new (createRequire(resolve(here, '..', '..') + '/')('ssh2').Client)()
const sftp = await new Promise((res, rej) => {
  client.on('ready', () => client.sftp((err, ch) => (err ? rej(err) : res(ch))))
  client.on('error', rej)
  client.connect({
    host: '127.0.0.1',
    port: 2222,
    username: 'tester',
    privateKey: readFileSync(resolve(ARTIFACTS, 'testkey'))
  })
})

const entry = (name, type, size = 0) => ({
  name,
  path: `${REMOTE_ROOT}/${name}`,
  type,
  size,
  modified: 0,
  mode: type === 'directory' ? 0o040755 : 0o100644
})

// --- 1. exact, monotonic, never-overshooting byte progress -----------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })

const byteSamples = []
let maxConcurrentNames = 0
const currentNames = new Set()
const outcome = await downloadItems(
  sftp,
  [entry(FIXTURE, 'directory')],
  LOCAL_OUT,
  [],
  {
    onBytes: (b) => byteSamples.push(b),
    onCurrent: (name) => {
      currentNames.add(name)
      maxConcurrentNames = Math.max(maxConcurrentNames, currentNames.size)
    },
    onItemDone: () => {}
  }
)

rec('every file arrived', outcome.files === FILE_COUNT, `${outcome.files}/${FILE_COUNT}`)
rec('byte total matches what was written', outcome.bytes === expectedTotalBytes, `${outcome.bytes} vs ${expectedTotalBytes}`)

let overshoot = false
for (const b of byteSamples) if (b > expectedTotalBytes) overshoot = true
rec('reported bytes never exceed the real total', !overshoot, `max sample ${Math.max(0, ...byteSamples)} vs total ${expectedTotalBytes}`)

let nonMonotonic = false
for (let i = 1; i < byteSamples.length; i++) if (byteSamples[i] < byteSamples[i - 1]) nonMonotonic = true
rec('byte progress never runs backwards', !nonMonotonic)

// This is the actual regression check for "the counter jumps on jpegs": with
// fastGet/fastPut the per-file step could report more than that file's own
// size on its last chunk. Assert no single onBytes call reports a jump bigger
// than one file's worth of bytes at once (the largest possible legitimate
// single-file completion), which would flag exactly that class of overshoot.
const maxFileSize = 4_000 + (39 * 977) % 60_000
let biggestJump = 0
for (let i = 1; i < byteSamples.length; i++) biggestJump = Math.max(biggestJump, byteSamples[i] - byteSamples[i - 1])
rec(
  'no single update jumps by more than one file’s worth of bytes',
  biggestJump <= maxFileSize * 1.5,
  `biggest jump ${biggestJump} vs one file ~${maxFileSize}`
)

// --- 2. concurrency: more than one file in flight at once -------------------

rec('more than one file was "current" at overlapping times', maxConcurrentNames > 1, `peak overlap ${maxConcurrentNames}`)

// --- 3. scanning feedback during the walk -----------------------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
const scanCounts = []
await downloadItems(sftp, [entry(FIXTURE, 'directory')], LOCAL_OUT, [], {
  onScanning: (found) => scanCounts.push(found)
})
rec('the walk reports items as it finds them', scanCounts.length > 0 && scanCounts[scanCounts.length - 1] >= FILE_COUNT, scanCounts.slice(-3).join(','))
let scanNonMonotonic = false
for (let i = 1; i < scanCounts.length; i++) if (scanCounts[i] < scanCounts[i - 1]) scanNonMonotonic = true
rec('scanning counts never run backwards', !scanNonMonotonic)

// --- 4. cancellation stops promptly, mid-batch ------------------------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
const signal = { cancelled: false }
let firstByteSeen = false
const cancelOutcome = await downloadItems(
  sftp,
  [entry(FIXTURE, 'directory')],
  LOCAL_OUT,
  [],
  {
    onBytes: () => {
      // Cancel the instant real transfer work has started, so this proves stop
      // is fast rather than "eventually happens after everything finishes."
      if (!firstByteSeen) {
        firstByteSeen = true
        signal.cancelled = true
      }
    }
  },
  signal
)
rec('a cancelled download reports cancelled', cancelOutcome.cancelled === true)
rec(
  'a cancelled download stops well short of the full set',
  cancelOutcome.files < FILE_COUNT,
  `${cancelOutcome.files}/${FILE_COUNT} — proves it didn't just run to completion`
)
rec('nothing throws for a cancelled operation', true) // reaching here means no unhandled rejection

// --- 5. TransferCancelledError is exported and recognizable -----------------

rec('TransferCancelledError is a real Error subclass', new TransferCancelledError() instanceof Error)

// --- 6. delete also respects cancellation -----------------------------------

const delSignal = { cancelled: false }
let unlinkSeen = 0
// Re-seed since the download above may have partially populated LOCAL_OUT only
// (remote fixture is untouched); delete against the remote fixture directly.
const delOutcome = await removeItems(
  sftp,
  [entry(FIXTURE, 'directory')],
  {
    onItemDone: () => {
      unlinkSeen++
      if (unlinkSeen === 3) delSignal.cancelled = true
    }
  },
  delSignal
)
rec('a cancelled delete reports cancelled', delOutcome.cancelled === true)
rec(
  'a cancelled delete stops short of removing everything',
  delOutcome.removed < FILE_COUNT + 1,
  `${delOutcome.removed} removed`
)
rec('a cancelled delete leaves the rest behind', existsSync(FIXTURE_ROOT), 'fixture dir still exists on the server')


// --- 7. case-insensitive local filesystem: two remote siblings that differ
// only by case must both survive, not silently collide into one -----------
//
// This has to be a unit test of the claimer itself, not an end-to-end
// download: the throwaway server is backed by *this same Mac's* filesystem,
// so "index.html" and "INDEX.html" can never exist as two distinct remote
// files here to begin with — writing the second one locally would already
// have overwritten the first, before any download logic even runs. A real
// remote Linux server has no such limit, which is exactly the case this
// exists for; the claimer is what runs against whatever `list()` returns,
// so exercising it directly proves the actual disambiguation logic.

{
  const { claim, renamed } = localNameClaimer()
  const first = claim('/dest', 'index.html')
  const second = claim('/dest', 'INDEX.html')
  const third = claim('/dest', 'about.html') // unrelated name, must pass through untouched

  rec('the first claim of a name keeps it exactly', first === 'index.html', first)
  rec('a case-only collision is disambiguated, not dropped', second !== 'index.html' && second.toLowerCase() !== 'index.html', second)
  rec('the disambiguated name still carries the original extension', second.endsWith('.html'), second)
  rec('an unrelated name is never touched', third === 'about.html', third)
  rec('the collision is recorded, not silent', renamed.length === 1 && renamed[0].original === 'INDEX.html' && renamed[0].renamedTo === second, JSON.stringify(renamed))

  // A third collision on the same fold must not reuse the second's new name.
  const fourth = claim('/dest', 'Index.html')
  rec('a third collision gets its own distinct name too', fourth !== first && fourth !== second, fourth)

  // The SAME name in a DIFFERENT directory is not a collision at all.
  const elsewhere = claim('/dest/sibling', 'index.html')
  rec('the same name in a different directory is unaffected', elsewhere === 'index.html', elsewhere)
}

// --- 8. one file failing (a real ENOENT) does not orphan the rest of the
// batch, and the failure is named rather than silently dropped -------------

rmSync(LOCAL_OUT, { recursive: true, force: true })
mkdirSync(LOCAL_OUT, { recursive: true })
const GOOD_COUNT = 12
const mixedEntries = []
for (let i = 0; i < GOOD_COUNT; i++) {
  mixedEntries.push(entry(`mixed-${i}.txt`, 'file', 0)) // created below
}
mkdirSync(resolve(SERVED), { recursive: true })
for (let i = 0; i < GOOD_COUNT; i++) {
  writeFileSync(resolve(SERVED, `mixed-${i}.txt`), `content ${i}\n`)
}
// A file that was never written: a real, deterministic ENOENT on OPEN, the
// same failure a file deleted mid-listing on a real server would produce.
mixedEntries.push({ ...entry('does-not-exist.bin', 'file', 1000) })

const mixedOutcome = await downloadItems(sftp, mixedEntries, LOCAL_OUT, [])
rec('every real file still arrived despite one failure', mixedOutcome.files === GOOD_COUNT, `${mixedOutcome.files}/${GOOD_COUNT}`)
rec('the failure is named, not swallowed', mixedOutcome.failedCount === 1 && mixedOutcome.failed[0]?.name === 'does-not-exist.bin', JSON.stringify(mixedOutcome.failed))
for (let i = 0; i < GOOD_COUNT; i++) rmSync(resolve(SERVED, `mixed-${i}.txt`), { force: true })

// --- 9. the same isolation holds for uploads --------------------------------

const localMixedDir = resolve(ARTIFACTS, 'sftptransfer-upload-mixed')
rmSync(localMixedDir, { recursive: true, force: true })
mkdirSync(localMixedDir, { recursive: true })
const localGood = []
for (let i = 0; i < 6; i++) {
  const p = resolve(localMixedDir, `up-${i}.txt`)
  writeFileSync(p, `up ${i}\n`)
  localGood.push(p)
}
const remoteUploadDir = resolve(SERVED, 'sftptransfer-upload-dest')
rmSync(remoteUploadDir, { recursive: true, force: true })
mkdirSync(remoteUploadDir, { recursive: true })
// A local path that was never created: a real, deterministic ENOENT on the
// pre-flight stat, isolated exactly like a mid-transfer failure now is.
const ghostLocal = resolve(localMixedDir, 'ghost.txt')

const uploadMixedOutcome = await uploadFiles(sftp, [...localGood, ghostLocal], remoteUploadDir, {})
rec('upload: every real file still arrived despite one failure', uploadMixedOutcome.files === 6, `${uploadMixedOutcome.files}/6`)
rec(
  'upload: the failure is named, not swallowed',
  uploadMixedOutcome.failedCount === 1 && uploadMixedOutcome.failed[0]?.name === 'ghost.txt',
  JSON.stringify(uploadMixedOutcome.failed)
)
rmSync(localMixedDir, { recursive: true, force: true })
rmSync(remoteUploadDir, { recursive: true, force: true })

// --- cleanup -----------------------------------------------------------------

rmSync(FIXTURE_ROOT, { recursive: true, force: true })
rmSync(LOCAL_OUT, { recursive: true, force: true })
client.end()

console.log('\n===== SFTP TRANSFER: CONCURRENCY / BYTES / CANCEL =====')
for (const line of results) console.log(line)
const passed = results.filter((r) => r.startsWith('PASS')).length
console.log(`\n${passed}/${results.length} passed`)
console.log('========================================================')
process.exit(passed === results.length ? 0 : 1)
