import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import { basename, join, posix } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { FileEntry, SFTPWrapper, Stats } from 'ssh2'
import type { SftpEntry } from '@shared/types'

/** Refuse to slurp huge files into the editor pane. */
const MAX_INLINE_EDIT_BYTES = 4 * 1024 * 1024

function promisify<T>(fn: (cb: (err: Error | null | undefined, result: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => (err ? reject(err) : resolve(result)))
  })
}

export function realpath(sftp: SFTPWrapper, path: string): Promise<string> {
  return promisify<string>((cb) => sftp.realpath(path, cb))
}

export async function list(sftp: SFTPWrapper, path: string): Promise<SftpEntry[]> {
  const resolved = await realpath(sftp, path)
  const items = await promisify<FileEntry[]>((cb) => sftp.readdir(resolved, cb))

  return items
    .map((item): SftpEntry => {
      const attrs = item.attrs
      const isDir = (attrs.mode & 0o170000) === 0o040000
      const isLink = (attrs.mode & 0o170000) === 0o120000
      return {
        name: item.filename,
        path: posix.join(resolved, item.filename),
        type: isDir ? 'directory' : isLink ? 'symlink' : 'file',
        size: attrs.size,
        modified: attrs.mtime * 1000,
        mode: attrs.mode
      }
    })
    .sort((a, b) => {
      // Directories first, then case-insensitive by name — Finder's ordering.
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (b.type === 'directory' && a.type !== 'directory') return 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
}

export async function readTextFile(sftp: SFTPWrapper, path: string): Promise<string> {
  const stats = await promisify<Stats>((cb) => sftp.stat(path, cb))
  if (stats.size > MAX_INLINE_EDIT_BYTES) {
    throw new Error(`File is ${Math.round(stats.size / 1e6)} MB — too large to edit inline`)
  }

  const chunks: Buffer[] = []
  const stream = sftp.createReadStream(path)
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

export function writeTextFile(sftp: SFTPWrapper, path: string, contents: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(path)
    stream.on('error', reject)
    stream.on('close', () => resolve())
    stream.end(Buffer.from(contents, 'utf8'))
  })
}

/** Byte-level callback shared by single and bulk transfers. */
export type ByteProgress = (transferred: number) => void

/** A shared flag a running transfer polls between chunks. Cheap to check, cheap to set. */
export interface CancelSignal {
  cancelled: boolean
}

/** Thrown to unwind a transfer that was stopped from the UI, not a real failure. */
export class TransferCancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'TransferCancelledError'
  }
}

/**
 * Pipes a readable into a writable with real byte-counted progress and a
 * cancellation point on every chunk.
 *
 * This replaces ssh2's `fastGet`/`fastPut`: their `step` callback reports
 * bytes in units of ssh2's own internal read-ahead window, which for a
 * directory of many small files (photos, icons, anything under ~32KB) can
 * report a chunk larger than the file itself on the final step — the counter
 * visibly jumps past the file's own size for an instant before the next file
 * resets it. Counting the real bytes of each chunk as it arrives is exact and
 * monotonic by construction, and gives cancellation a place to take effect
 * immediately instead of only between whole files.
 */
function pump(
  readable: Readable,
  writable: Writable,
  onBytes?: ByteProgress,
  signal?: CancelSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transferred = 0
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      readable.removeAllListeners()
      writable.removeAllListeners()
      if (err) reject(err)
      else resolve()
    }

    readable.on('data', (chunk: Buffer) => {
      if (signal?.cancelled) {
        finish(new TransferCancelledError())
        readable.destroy()
        writable.destroy()
        return
      }
      transferred += chunk.length
      onBytes?.(transferred)
    })
    readable.on('error', finish)
    writable.on('error', finish)
    writable.on('close', () => finish())
    readable.pipe(writable)
  })
}

export function download(
  sftp: SFTPWrapper,
  remote: string,
  local: string,
  onBytes?: ByteProgress,
  signal?: CancelSignal
): Promise<void> {
  return pump(sftp.createReadStream(remote), createWriteStream(local), onBytes, signal)
}

export function upload(
  sftp: SFTPWrapper,
  local: string,
  remote: string,
  onBytes?: ByteProgress,
  signal?: CancelSignal
): Promise<void> {
  return pump(createReadStream(local), sftp.createWriteStream(remote), onBytes, signal)
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once.
 *
 * SFTP is one request/response protocol over one channel, so many small files
 * pay a full round trip of latency each — sequential transfer leaves the link
 * idle between every file. A handful of requests in flight overlaps that
 * latency without the cost or the complication of real threads (Node has one;
 * this is concurrent I/O, not parallel CPU work, which is all a *transfer*
 * ever needs). The limit is deliberately modest: this app talks to home
 * servers and small boxes as often as beefy ones, and flooding a modest
 * server's SFTP subsystem with requests wastes the connection rather than
 * using it well. Stops launching new work once `signal` is cancelled, but
 * lets whatever is already in flight settle so its own cancellation check
 * (inside `pump`) is what actually stops it.
 */
async function mapPool<T>(
  items: T[],
  limit: number,
  signal: CancelSignal | undefined,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0

  // `fn` owns per-item failure: it must record a real error against that item
  // and return normally, never reject for one. Only cancellation is allowed to
  // reject here.
  //
  // An earlier version caught a per-item rejection *here*, retired that one
  // worker and moved on. That looked safe — the other lanes kept claiming
  // `cursor` — but it wasn't: a burst of near-simultaneous failures (a server
  // that briefly rejects a handful of concurrent opens, which several files
  // can trip at once under `TRANSFER_CONCURRENCY` lanes) could retire *every*
  // lane within the same window, and whatever was left in the queue was never
  // claimed by anyone again — silently, with the operation still reporting the
  // files it had already finished as a success. That is the shape of "some
  // files never arrived and nothing said why."
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.cancelled) return
      const index = cursor++
      if (index >= items.length) return
      await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** How many files move at once. See `mapPool` for why this isn't higher. */
const TRANSFER_CONCURRENCY = 4

/** A brief pause before retrying a transient failure. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How many times a single file's transfer is retried before it's given up on. */
const TRANSFER_ATTEMPTS = 3

/**
 * Runs one file's transfer, retrying a real failure a couple of times before
 * giving up. Cancellation is never retried — it propagates immediately so the
 * batch actually stops. A permanent failure is recorded by name and reason and
 * swallowed here, on purpose: one bad file must not cost every file behind it
 * in the queue (see `mapPool`), and it must never vanish without a trace either
 * — every name in `failed` is a promise that this file did not silently
 * disappear, whatever happened to it.
 */
async function transferWithRetry(
  name: string,
  attempt: (attemptNumber: number) => Promise<void>,
  failed: { name: string; error: string }[],
  signal?: CancelSignal
): Promise<boolean> {
  for (let n = 1; n <= TRANSFER_ATTEMPTS; n++) {
    try {
      await attempt(n)
      return true
    } catch (err) {
      if (err instanceof TransferCancelledError || signal?.cancelled) throw new TransferCancelledError()
      if (n === TRANSFER_ATTEMPTS) {
        failed.push({ name, error: err instanceof Error ? err.message : String(err) })
        return false
      }
      // Real transient hiccups on a live connection usually clear well under a
      // second; no reason to hammer the server immediately after one.
      await sleep(150 * n)
    }
  }
  return false
}

/**
 * Reports a bulk operation's shape and movement. `onTotals` fires once the
 * pre-walk knows the size of the job, so the UI can show a real denominator
 * instead of an indeterminate spinner.
 */
export interface BulkHooks {
  onTotals?: (items: number, bytes: number) => void
  onCurrent?: (name: string) => void
  /** Cumulative bytes across the whole operation. */
  onBytes?: (bytes: number) => void
  onItemDone?: (bytes: number) => void
  /** Fires while the pre-walk is still discovering items, before totals exist. */
  onScanning?: (found: number) => void
  /** One file's own progress — see `TransferReporter.setCurrentFileProgress`. */
  onCurrentProgress?: (name: string, transferred: number, total: number) => void
}

/**
 * Exclusion patterns, in the shape people already know from `.gitignore` and
 * `rsync --exclude`. Kept deliberately small, and documented in the dialog that
 * collects them, because a pattern language you have to guess at is worse than
 * none — you find out what it did after the download.
 *
 * - `node_modules` — no slash, so it matches an entry's *name* at any depth.
 * - `*.log` — same, with a glob. `*` stops at a `/`, `**` crosses one, `?` is
 *   one character.
 * - `build/` — a trailing slash restricts the match to directories.
 * - `src/generated` — a slash anywhere anchors the pattern to the path the
 *   entry will have on disk, under the folder you chose. A leading slash does
 *   the same and reads more clearly.
 *
 * Matching a directory prunes it: nothing under it is walked, listed or
 * counted, which is the whole point of excluding `node_modules`.
 */
export type ExcludeMatcher = (relativePath: string, name: string, isDirectory: boolean) => boolean

/** One glob segment to a regular expression. `**` crosses separators; `*` does not. */
function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * Build a matcher from a list of patterns. Blank lines and `#` comments are
 * ignored so a pattern set can be commented, and an unparseable pattern is
 * dropped rather than throwing mid-walk.
 */
export function compileExcludes(patterns: string[]): ExcludeMatcher {
  const rules: { re: RegExp; directoriesOnly: boolean; againstPath: boolean }[] = []

  for (const raw of patterns) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const directoriesOnly = trimmed.endsWith('/')
    const body = trimmed.replace(/\/+$/, '').replace(/^\/+/, '')
    if (!body) continue

    try {
      rules.push({
        re: globToRegExp(body),
        directoriesOnly,
        // A slash anywhere means the pattern is about a location, not a name.
        againstPath: trimmed.replace(/\/+$/, '').includes('/')
      })
    } catch {
      /* an unparseable pattern excludes nothing rather than failing the job */
    }
  }

  if (!rules.length) return () => false
  return (relativePath, name, isDirectory) =>
    rules.some(
      (rule) =>
        (!rule.directoriesOnly || isDirectory) &&
        rule.re.test(rule.againstPath ? relativePath : name)
    )
}

/** Depth cap for a recursive download; deep enough for real trees, shallow enough to bound a cycle. */
const MAX_DEPTH = 32

/**
 * Hard ceiling on entries discovered while walking. The symlink and realpath
 * guards below depend on the server describing its own tree honestly; this one
 * does not, so it is what actually bounds the work if a server misreports a
 * link as a directory and the walk starts descending the whole filesystem.
 */
const MAX_ENTRIES = 50_000

/** How many skipped paths to keep for the UI; the rest are only counted. */
const MAX_SKIPPED_LISTED = 100

/** What a bulk transfer did, and what it deliberately did not do. */
export interface BulkOutcome {
  files: number
  bytes: number
  /** Paths passed over for a reason the *walk* imposed — a symlink, a cycle. */
  skipped: string[]
  skippedCount: number
  /** Paths passed over because the user asked for them to be. */
  excluded: string[]
  excludedCount: number
  /** Stopped early from the UI, not from an error. `files`/`bytes` are what finished first. */
  cancelled?: boolean
  /**
   * Remote siblings that differ only by case, renamed so both survive on a
   * case-insensitive destination. See `localNameClaimer`.
   */
  renamed: { original: string; renamedTo: string }[]
  renamedCount: number
  /** Files that failed every retry. Named, with why — never silent. */
  failed: { name: string; error: string }[]
  failedCount: number
}

/**
 * Guards against a destination filesystem that folds case (macOS's default
 * APFS, and Windows) while the source doesn't have to. Two remote entries in
 * the same directory that differ only by case — `index.html` and
 * `Index.html`, which real exports and case-migrated sites genuinely have —
 * would otherwise both claim the same local path: the second write silently
 * overwrites the first, with no error and no sign anything happened. The
 * *reported* count still says both were "downloaded," so the on-screen total
 * quietly disagrees with what's actually sitting on disk.
 *
 * Every name handed out in a given local directory is remembered case-folded.
 * A second claim on the same fold is not refused — it's disambiguated with a
 * ` (2)`-style suffix before the extension, the same shape Finder and Windows
 * Explorer already use for a name collision, so both files actually land, and
 * the collision is recorded so the finish summary can say so.
 */
export function localNameClaimer(): {
  claim: (localDir: string, name: string) => string
  renamed: { original: string; renamedTo: string }[]
} {
  const claimedPerDir = new Map<string, Set<string>>()
  const renamed: { original: string; renamedTo: string }[] = []

  const claim = (localDir: string, name: string): string => {
    let claimed = claimedPerDir.get(localDir)
    if (!claimed) {
      claimed = new Set()
      claimedPerDir.set(localDir, claimed)
    }

    const fold = name.toLowerCase()
    if (!claimed.has(fold)) {
      claimed.add(fold)
      return name
    }

    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let n = 2
    let candidate = `${stem} (${n})${ext}`
    while (claimed.has(candidate.toLowerCase())) {
      n++
      candidate = `${stem} (${n})${ext}`
    }
    claimed.add(candidate.toLowerCase())
    renamed.push({ original: name, renamedTo: candidate })
    return candidate
  }

  return { claim, renamed }
}

/**
 * Recursively copy remote files and directories into one local directory.
 *
 * The whole selection is walked before anything transfers, so progress has a
 * real denominator across the batch rather than resetting at each item, and so
 * the entry ceiling bounds the job as a whole rather than each item separately.
 *
 * `excludes` prunes as it walks: a directory that matches is never listed, so
 * excluding `node_modules` costs nothing instead of costing a walk you throw
 * away. Patterns are matched against the path the entry *would* have on disk,
 * under the folder you chose — what you type mirrors what lands there.
 *
 * Two guards keep a hostile or unusual tree from turning this into an unbounded
 * copy of the whole filesystem: symlinks are skipped rather than followed, and
 * each directory's resolved path is recorded so a cycle (or a server that
 * reports a link to `/` as a plain directory, which some do) can't loop. The
 * depth cap is the backstop if both of those are somehow defeated.
 */
export async function downloadItems(
  sftp: SFTPWrapper,
  entries: SftpEntry[],
  localRoot: string,
  excludes: string[] = [],
  hooks: BulkHooks = {},
  signal?: CancelSignal
): Promise<BulkOutcome> {
  const isExcluded = compileExcludes(excludes)

  const files: { remote: string; local: string; size: number }[] = []
  const dirs: string[] = []
  const skipped: string[] = []
  const excluded: string[] = []
  const visited = new Set<string>()
  const { claim, renamed } = localNameClaimer()

  // Everything the walk examines counts toward the ceiling — not just files and
  // directories. An early version counted only those, and a pathological tree
  // filled the *skipped* list with depth-limit notes until the process ran out
  // of memory. Both lists are capped separately for the same reason.
  let examined = 0
  let skippedCount = 0
  let excludedCount = 0

  const note = (reason: string): void => {
    skippedCount++
    if (skipped.length < MAX_SKIPPED_LISTED) skipped.push(reason)
  }

  const noteExcluded = (relative: string): void => {
    excludedCount++
    if (excluded.length < MAX_SKIPPED_LISTED) excluded.push(relative)
  }

  const count = (): void => {
    if (++examined > MAX_ENTRIES) {
      throw new Error(
        `Refusing to continue: more than ${MAX_ENTRIES.toLocaleString()} entries in this download. ` +
          'Download a smaller subtree, exclude more of it, or archive it on the server first.'
      )
    }
    // The walk is real round trips over the connection with nothing else to
    // show — a big tree used to look exactly like a stuck button. This is what
    // lets the dialog say "Scanning… N found" instead.
    hooks.onScanning?.(examined)
  }

  const walk = async (
    remoteDir: string,
    localDir: string,
    relativeDir: string,
    root: string,
    depth: number
  ): Promise<void> => {
    if (signal?.cancelled) throw new TransferCancelledError()
    count()

    if (depth > MAX_DEPTH) {
      note(`${remoteDir} (depth limit)`)
      return
    }

    // Resolve before descending so a cycle is caught on its second visit.
    let resolved: string
    try {
      resolved = await realpath(sftp, remoteDir)
    } catch {
      resolved = remoteDir
    }
    if (visited.has(resolved)) {
      note(`${remoteDir} (already visited)`)
      return
    }
    visited.add(resolved)

    // Escaping the requested root means we followed something we shouldn't have.
    if (resolved !== root && !resolved.startsWith(`${root.replace(/\/$/, '')}/`)) {
      note(`${remoteDir} (outside the download root)`)
      return
    }

    dirs.push(localDir)
    for (const entry of await list(sftp, remoteDir)) {
      const relative = `${relativeDir}/${entry.name}`
      if (isExcluded(relative, entry.name, entry.type === 'directory')) {
        count()
        noteExcluded(relative)
        continue
      }
      // Claimed even for a symlink we're about to skip, so a same-cased file
      // that follows it in the listing still lands cleanly.
      const localPath = join(localDir, claim(localDir, entry.name))
      if (entry.type === 'symlink') {
        count()
        note(entry.path)
      } else if (entry.type === 'directory') {
        await walk(entry.path, localPath, relative, root, depth + 1)
      } else {
        count()
        files.push({ remote: entry.path, local: localPath, size: entry.size })
      }
    }
  }

  try {
    for (const entry of entries) {
      if (signal?.cancelled) throw new TransferCancelledError()
      // A selected item is matched too: with a mixed selection, `*.log` should
      // drop the logs you picked as readily as the ones it finds inside a folder.
      if (isExcluded(entry.name, entry.name, entry.type === 'directory')) {
        noteExcluded(entry.name)
        continue
      }

      if (entry.type === 'directory') {
        const root = await realpath(sftp, entry.path)
        const name = claim(localRoot, posix.basename(root))
        await walk(root, join(localRoot, name), posix.basename(root), root, 0)
      } else if (entry.type === 'symlink') {
        count()
        note(entry.path)
      } else {
        count()
        const name = claim(localRoot, entry.name)
        files.push({ remote: entry.path, local: join(localRoot, name), size: entry.size })
      }
    }
  } catch (err) {
    if (err instanceof TransferCancelledError) {
      return {
        files: 0,
        bytes: 0,
        skipped,
        skippedCount,
        excluded,
        excludedCount,
        cancelled: true,
        renamed,
        renamedCount: renamed.length,
        failed: [],
        failedCount: 0
      }
    }
    throw err
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  hooks.onTotals?.(files.length, totalBytes)

  for (const dir of dirs) mkdirSync(dir, { recursive: true })

  // Several files move at once — see `mapPool` — so the byte total is the sum
  // of what's fully done plus a live counter per file still in flight, rather
  // than one running number a single transfer could just add onto.
  let doneBytes = 0
  const inFlight = new Map<number, number>()
  const reportBytes = (): void => {
    let live = 0
    for (const v of inFlight.values()) live += v
    hooks.onBytes?.(doneBytes + live)
  }

  let cancelled = false
  let filesDone = 0
  const failed: { name: string; error: string }[] = []

  try {
    await mapPool(files, TRANSFER_CONCURRENCY, signal, async (file, index) => {
      hooks.onCurrent?.(posix.basename(file.remote))
      const name = posix.basename(file.remote)
      const ok = await transferWithRetry(
        name,
        () =>
          download(
            sftp,
            file.remote,
            file.local,
            (transferred) => {
              inFlight.set(index, transferred)
              reportBytes()
              hooks.onCurrentProgress?.(name, transferred, file.size)
            },
            signal
          ),
        failed,
        signal
      )
      inFlight.delete(index)
      if (ok) {
        filesDone++
        doneBytes += file.size
        hooks.onItemDone?.(doneBytes)
      }
    })
  } catch (err) {
    if (!(err instanceof TransferCancelledError)) throw err
    cancelled = true
  }

  return {
    files: filesDone,
    bytes: doneBytes,
    skipped,
    skippedCount,
    excluded,
    excludedCount,
    cancelled: cancelled || undefined,
    renamed,
    renamedCount: renamed.length,
    failed,
    failedCount: failed.length
  }
}

/** Upload local files into a remote directory, reporting bytes as they go. */
export async function uploadFiles(
  sftp: SFTPWrapper,
  locals: string[],
  remoteDir: string,
  hooks: BulkHooks = {},
  signal?: CancelSignal
): Promise<{
  files: number
  bytes: number
  names: string[]
  cancelled?: boolean
  failed: { name: string; error: string }[]
  failedCount: number
}> {
  const failed: { name: string; error: string }[] = []

  // A local file the OS picker offered a moment ago can already be gone by
  // the time this runs (moved, deleted, an ejected volume). That must cost
  // this one file, not the whole batch — recorded exactly like a real
  // transfer failure, since from here it is one.
  const items: { local: string; name: string; size: number }[] = []
  for (const local of locals) {
    try {
      items.push({ local, name: basename(local), size: statSync(local).size })
    } catch (err) {
      failed.push({ name: basename(local), error: err instanceof Error ? err.message : String(err) })
    }
  }

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0)
  hooks.onTotals?.(items.length, totalBytes)

  // Several files move at once — see `mapPool` — so bytes are done-so-far plus
  // a live counter per file still in flight.
  let doneBytes = 0
  const inFlight = new Map<number, number>()
  const reportBytes = (): void => {
    let live = 0
    for (const v of inFlight.values()) live += v
    hooks.onBytes?.(doneBytes + live)
  }

  let cancelled = false
  const names: string[] = []

  try {
    await mapPool(items, TRANSFER_CONCURRENCY, signal, async (item, index) => {
      hooks.onCurrent?.(item.name)
      const remote = `${remoteDir.replace(/\/$/, '')}/${item.name}`
      const ok = await transferWithRetry(
        item.name,
        () =>
          upload(
            sftp,
            item.local,
            remote,
            (transferred) => {
              inFlight.set(index, transferred)
              reportBytes()
              hooks.onCurrentProgress?.(item.name, transferred, item.size)
            },
            signal
          ),
        failed,
        signal
      )
      inFlight.delete(index)
      if (ok) {
        names.push(item.name)
        doneBytes += item.size
        hooks.onItemDone?.(doneBytes)
      }
    })
  } catch (err) {
    if (!(err instanceof TransferCancelledError)) throw err
    cancelled = true
  }

  return {
    files: names.length,
    bytes: doneBytes,
    names,
    cancelled: cancelled || undefined,
    failed,
    failedCount: failed.length
  }
}

/**
 * Recursively copy a local directory to a remote one.
 *
 * The mirror of `downloadDirectory`, and it carries the same guards for the
 * same reason: a symlink is skipped rather than followed, each directory's
 * resolved path is recorded so a cycle cannot loop, everything examined counts
 * toward one ceiling, and depth is capped as the backstop. A link to `/` in a
 * folder you drag in must not turn an upload into a copy of your disk.
 *
 * Directories are created before the files that go in them, deepest last, so a
 * failure part-way leaves a partial tree rather than orphaned files.
 */
export async function uploadDirectory(
  sftp: SFTPWrapper,
  localRoot: string,
  remoteParent: string,
  hooks: BulkHooks = {},
  signal?: CancelSignal
): Promise<{
  files: number
  bytes: number
  skipped: string[]
  skippedCount: number
  cancelled?: boolean
  failed: { name: string; error: string }[]
  failedCount: number
}> {
  const root = realpathSync(localRoot)
  const remoteRoot = `${remoteParent.replace(/\/$/, '')}/${basename(root)}`

  const files: { local: string; remote: string; size: number }[] = []
  const dirs: string[] = [remoteRoot]
  const skipped: string[] = []
  const visited = new Set<string>([root])

  let examined = 0
  let skippedCount = 0

  const note = (reason: string): void => {
    skippedCount++
    if (skipped.length < MAX_SKIPPED_LISTED) skipped.push(reason)
  }

  const count = (): void => {
    if (++examined > MAX_ENTRIES) {
      throw new Error(
        `Refusing to continue: more than ${MAX_ENTRIES.toLocaleString()} entries under ${root}. ` +
          'Upload a smaller subtree, or archive it first.'
      )
    }
  }

  const walk = (localDir: string, remoteDir: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      note(`${localDir} (deeper than ${MAX_DEPTH} levels)`)
      return
    }

    for (const entry of readdirSync(localDir, { withFileTypes: true })) {
      count()
      const local = join(localDir, entry.name)
      const remote = posix.join(remoteDir, entry.name)

      if (entry.isSymbolicLink()) {
        note(`${local} (symlink)`)
        continue
      }

      if (entry.isDirectory()) {
        let resolved: string
        try {
          resolved = realpathSync(local)
        } catch {
          note(`${local} (unreadable)`)
          continue
        }
        if (visited.has(resolved)) {
          note(`${local} (already visited — cycle)`)
          continue
        }
        visited.add(resolved)
        dirs.push(remote)
        walk(local, remote, depth + 1)
        continue
      }

      if (!entry.isFile()) {
        note(`${local} (not a regular file)`)
        continue
      }

      try {
        files.push({ local, remote, size: statSync(local).size })
      } catch {
        note(`${local} (unreadable)`)
      }
    }
  }

  walk(root, remoteRoot, 1)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  hooks.onTotals?.(files.length, totalBytes)

  // Shallowest first: a child directory cannot be created before its parent.
  for (const dir of dirs.sort((a, b) => a.split('/').length - b.split('/').length)) {
    try {
      await mkdir(sftp, dir)
    } catch {
      // Already there is the common case, and is not an error worth stopping for.
    }
  }

  // Several files move at once — see `mapPool` — so bytes are done-so-far plus
  // a live counter per file still in flight.
  let doneBytes = 0
  const inFlight = new Map<number, number>()
  const reportBytes = (): void => {
    let live = 0
    for (const v of inFlight.values()) live += v
    hooks.onBytes?.(doneBytes + live)
  }

  let cancelled = false
  let filesDone = 0
  const failed: { name: string; error: string }[] = []

  try {
    await mapPool(files, TRANSFER_CONCURRENCY, signal, async (file, index) => {
      hooks.onCurrent?.(basename(file.local))
      const name = basename(file.local)
      const ok = await transferWithRetry(
        name,
        () =>
          upload(
            sftp,
            file.local,
            file.remote,
            (transferred) => {
              inFlight.set(index, transferred)
              reportBytes()
              hooks.onCurrentProgress?.(name, transferred, file.size)
            },
            signal
          ),
        failed,
        signal
      )
      inFlight.delete(index)
      if (ok) {
        filesDone++
        doneBytes += file.size
        hooks.onItemDone?.(doneBytes)
      }
    })
  } catch (err) {
    if (!(err instanceof TransferCancelledError)) throw err
    cancelled = true
  }

  return {
    files: filesDone,
    bytes: doneBytes,
    skipped,
    skippedCount,
    cancelled: cancelled || undefined,
    failed,
    failedCount: failed.length
  }
}

export function mkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return promisify<void>((cb) => sftp.mkdir(path, cb as never))
}

/** Create an empty file, failing if something is already there. */
export function touch(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 'wx' so we never silently truncate an existing file.
    sftp.open(path, 'wx', 0o644, (err, handle) => {
      if (err) return reject(err)
      sftp.close(handle, (closeErr) => (closeErr ? reject(closeErr) : resolve()))
    })
  })
}

export function chmod(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  return promisify<void>((cb) => sftp.chmod(path, mode, cb as never))
}

export function stat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return promisify<Stats>((cb) => sftp.stat(path, cb))
}

export function rename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return promisify<void>((cb) => sftp.rename(from, to, cb as never))
}

const unlink = (sftp: SFTPWrapper, path: string) =>
  promisify<void>((cb) => sftp.unlink(path, cb as never))

const rmdir = (sftp: SFTPWrapper, path: string) =>
  promisify<void>((cb) => sftp.rmdir(path, cb as never))

/**
 * Delete files and directories, and everything under the directories.
 *
 * SFTP's rmdir only removes empty directories, so a non-empty folder has to be
 * emptied depth-first. The same guards as the recursive download apply: a
 * symlink is unlinked rather than descended into (following one to `/` would be
 * catastrophic here, not merely slow), and the entry ceiling bounds the walk —
 * across the whole selection, not per item.
 */
export async function removeItems(
  sftp: SFTPWrapper,
  entries: SftpEntry[],
  hooks: BulkHooks = {},
  signal?: CancelSignal
): Promise<{ removed: number; cancelled?: boolean }> {
  // Count first so the progress bar has a denominator. Worth the extra pass:
  // a recursive delete is the one operation you most want to watch finish.
  hooks.onTotals?.(await countItems(sftp, entries, hooks.onScanning, signal), 0)

  let removed = 0
  const step = (name: string) => {
    hooks.onCurrent?.(name)
    removed++
    hooks.onItemDone?.(0)
  }

  const purge = async (dir: string, root: string, depth: number): Promise<void> => {
    if (signal?.cancelled) throw new TransferCancelledError()
    if (depth > MAX_DEPTH) {
      throw new Error(`Refusing to delete deeper than ${MAX_DEPTH} levels below ${root}`)
    }
    if (removed > MAX_ENTRIES) {
      throw new Error(
        `Refusing to delete more than ${MAX_ENTRIES.toLocaleString()} entries under ${root}.`
      )
    }

    for (const child of await list(sftp, dir)) {
      if (signal?.cancelled) throw new TransferCancelledError()
      if (child.type === 'directory') {
        await purge(child.path, root, depth + 1)
      } else {
        // Covers symlinks too: unlink removes the link, never its target.
        await unlink(sftp, child.path)
        step(child.name)
      }
    }

    await rmdir(sftp, dir)
    step(posix.basename(dir))
  }

  try {
    for (const entry of entries) {
      if (signal?.cancelled) throw new TransferCancelledError()
      if (entry.type === 'directory') {
        await purge(entry.path, entry.path, 0)
      } else {
        hooks.onCurrent?.(entry.name)
        await unlink(sftp, entry.path)
        step(entry.name)
      }
    }
  } catch (err) {
    if (err instanceof TransferCancelledError) return { removed, cancelled: true }
    throw err
  }

  return { removed }
}

/** How many entries a recursive delete would touch, for the confirmation prompt. */
export async function countItems(
  sftp: SFTPWrapper,
  entries: SftpEntry[],
  onScanning?: (found: number) => void,
  signal?: CancelSignal
): Promise<number> {
  let total = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || total > MAX_ENTRIES || signal?.cancelled) return
    for (const child of await list(sftp, dir)) {
      total++
      onScanning?.(total)
      if (child.type === 'directory') await walk(child.path, depth + 1)
    }
  }

  for (const entry of entries) {
    if (signal?.cancelled) break
    // The entry itself counts: deleting a folder removes the folder too.
    total++
    onScanning?.(total)
    if (entry.type === 'directory') await walk(entry.path, 0)
  }

  return total
}
