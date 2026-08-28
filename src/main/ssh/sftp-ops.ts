import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
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

export function download(
  sftp: SFTPWrapper,
  remote: string,
  local: string,
  onBytes?: ByteProgress
): Promise<void> {
  return promisify<void>((cb) =>
    sftp.fastGet(
      remote,
      local,
      // ssh2 reports cumulative bytes for this file as `transferred`.
      onBytes ? { step: (transferred: number) => onBytes(transferred) } : {},
      cb as never
    )
  )
}

export function upload(
  sftp: SFTPWrapper,
  local: string,
  remote: string,
  onBytes?: ByteProgress
): Promise<void> {
  return promisify<void>((cb) =>
    sftp.fastPut(
      local,
      remote,
      onBytes ? { step: (transferred: number) => onBytes(transferred) } : {},
      cb as never
    )
  )
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

/**
 * Recursively copy a remote directory to a local one.
 *
 * The tree is walked first so progress has a real denominator.
 *
 * Two guards keep a hostile or unusual tree from turning this into an unbounded
 * copy of the whole filesystem: symlinks are skipped rather than followed, and
 * each directory's resolved path is recorded so a cycle (or a server that
 * reports a link to `/` as a plain directory, which some do) can't loop. The
 * depth cap is the backstop if both of those are somehow defeated.
 */
export async function downloadDirectory(
  sftp: SFTPWrapper,
  remoteRoot: string,
  localRoot: string,
  hooks: BulkHooks = {}
): Promise<{ files: number; bytes: number; skipped: string[]; skippedCount: number }> {
  const root = await realpath(sftp, remoteRoot)

  const files: { remote: string; local: string; size: number }[] = []
  const dirs: string[] = []
  const skipped: string[] = []
  const visited = new Set<string>()

  // Everything the walk examines counts toward the ceiling — not just files and
  // directories. An early version counted only those, and a pathological tree
  // filled the *skipped* list with depth-limit notes until the process ran out
  // of memory. The skipped list is capped separately for the same reason.
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
          'Download a smaller subtree, or archive it on the server first.'
      )
    }
  }

  const walk = async (remoteDir: string, localDir: string, depth: number): Promise<void> => {
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
      const localPath = join(localDir, entry.name)
      if (entry.type === 'symlink') {
        count()
        note(entry.path)
      } else if (entry.type === 'directory') {
        await walk(entry.path, localPath, depth + 1)
      } else {
        count()
        files.push({ remote: entry.path, local: localPath, size: entry.size })
      }
    }
  }

  await walk(root, join(localRoot, posix.basename(root)), 0)

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  hooks.onTotals?.(files.length, totalBytes)

  for (const dir of dirs) mkdirSync(dir, { recursive: true })

  // `completed` tracks whole files; the step callback adds the in-flight file's
  // partial bytes on top so the counter advances smoothly within a large file.
  let completed = 0
  for (const file of files) {
    hooks.onCurrent?.(posix.basename(file.remote))
    await download(sftp, file.remote, file.local, (transferred) =>
      hooks.onBytes?.(completed + transferred)
    )
    completed += file.size
    hooks.onItemDone?.(completed)
  }

  return { files: files.length, bytes: totalBytes, skipped, skippedCount }
}

/** Upload local files into a remote directory, reporting bytes as they go. */
export async function uploadFiles(
  sftp: SFTPWrapper,
  locals: string[],
  remoteDir: string,
  hooks: BulkHooks = {}
): Promise<{ files: number; bytes: number; names: string[] }> {
  const items = locals.map((local) => ({
    local,
    name: basename(local),
    size: statSync(local).size
  }))

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0)
  hooks.onTotals?.(items.length, totalBytes)

  let completed = 0
  for (const item of items) {
    hooks.onCurrent?.(item.name)
    const remote = `${remoteDir.replace(/\/$/, '')}/${item.name}`
    await upload(sftp, item.local, remote, (transferred) =>
      hooks.onBytes?.(completed + transferred)
    )
    completed += item.size
    hooks.onItemDone?.(completed)
  }

  return { files: items.length, bytes: totalBytes, names: items.map((i) => i.name) }
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
  hooks: BulkHooks = {}
): Promise<{ files: number; bytes: number; skipped: string[]; skippedCount: number }> {
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

  let completed = 0
  for (const file of files) {
    hooks.onCurrent?.(basename(file.local))
    await upload(sftp, file.local, file.remote, (transferred) =>
      hooks.onBytes?.(completed + transferred)
    )
    completed += file.size
    hooks.onItemDone?.(completed)
  }

  return { files: files.length, bytes: totalBytes, skipped, skippedCount }
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
 * Delete a file, or a directory and everything under it.
 *
 * SFTP's rmdir only removes empty directories, so a non-empty folder has to be
 * emptied depth-first. The same guards as the recursive download apply: a
 * symlink is unlinked rather than descended into (following one to `/` would be
 * catastrophic here, not merely slow), and the entry ceiling bounds the walk.
 */
export async function remove(
  sftp: SFTPWrapper,
  entry: SftpEntry,
  hooks: BulkHooks = {}
): Promise<{ removed: number }> {
  if (entry.type !== 'directory') {
    hooks.onTotals?.(1, 0)
    hooks.onCurrent?.(entry.name)
    await unlink(sftp, entry.path)
    hooks.onItemDone?.(0)
    return { removed: 1 }
  }

  // Count first so the progress bar has a denominator. Worth the extra pass:
  // a recursive delete is the one operation you most want to watch finish.
  const total = await countEntries(sftp, entry)
  hooks.onTotals?.(total + 1, 0)

  let removed = 0
  const step = (name: string) => {
    hooks.onCurrent?.(name)
    removed++
    hooks.onItemDone?.(0)
  }

  const purge = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      throw new Error(`Refusing to delete deeper than ${MAX_DEPTH} levels below ${entry.path}`)
    }
    if (removed > MAX_ENTRIES) {
      throw new Error(
        `Refusing to delete more than ${MAX_ENTRIES.toLocaleString()} entries under ${entry.path}.`
      )
    }

    for (const child of await list(sftp, dir)) {
      if (child.type === 'directory') {
        await purge(child.path, depth + 1)
      } else {
        // Covers symlinks too: unlink removes the link, never its target.
        await unlink(sftp, child.path)
        step(child.name)
      }
    }

    await rmdir(sftp, dir)
    step(posix.basename(dir))
  }

  await purge(entry.path, 0)
  return { removed }
}

/** How many entries a recursive delete would touch, for the confirmation prompt. */
export async function countEntries(sftp: SFTPWrapper, entry: SftpEntry): Promise<number> {
  if (entry.type !== 'directory') return 1

  let total = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || total > MAX_ENTRIES) return
    for (const child of await list(sftp, dir)) {
      total++
      if (child.type === 'directory') await walk(child.path, depth + 1)
    }
  }

  await walk(entry.path, 0)
  return total
}
