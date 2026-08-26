import { useCallback, useEffect, useRef, useState } from 'react'
import type { SftpEntry, TransferProgress } from '@shared/types'
import { useExclusive } from '../hooks/useExclusive'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FileProperties, modeToRwx } from './FileProperties'
import { usePrompt } from './InputDialog'
import {
  IconCheck,
  IconDelete,
  IconDownload,
  IconGoUp,
  IconNewFile,
  IconNewFolder,
  IconRefresh,
  IconUpload
} from './Icons'
import { RemoteEditor } from './RemoteEditor'
import { TransferBar } from './TransferBar'

interface Props {
  tabId: string
  /** Directory the terminal last reported via OSC 7. */
  cwd: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

const joinPath = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`

/** How often to check the open directory for outside changes. */
const POLL_INTERVAL_MS = 1500

export function FileBrowser({ tabId, cwd }: Props) {
  const [path, setPath] = useState(cwd || '.')
  const [pathDraft, setPathDraft] = useState(path)
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [selected, setSelected] = useState<SftpEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [follow, setFollow] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry | null } | null>(null)
  const [transfer, setTransfer] = useState<TransferProgress | null>(null)
  // Read by the poll loop; a state dep would restart the timer on every update.
  const transferRef = useRef(false)
  // One SFTP mutation at a time; a second click while a confirm is open would
  // otherwise stack another dialog behind it.
  const { busy: opBusy, run: exclusive } = useExclusive()
  // Also read by the poll loop, via a ref so it doesn't restart the timer.
  const opBusyRef = useRef(false)
  opBusyRef.current = opBusy
  // Electron has no window.prompt, so naming uses an in-app dialog.
  const { ask, dialog: promptDialog } = usePrompt()
  const [editing, setEditing] = useState<string | null>(null)
  const [properties, setProperties] = useState<SftpEntry | null>(null)

  // Read inside the cwd effect without making it a dependency.
  const followRef = useRef(follow)
  followRef.current = follow

  useEffect(() => {
    if (cwd && followRef.current) setPath(cwd)
  }, [cwd])

  useEffect(() => {
    setPathDraft(path)
    setSelected(null)
  }, [path])

  /** Cheap identity for a listing, so a poll that changed nothing re-renders nothing. */
  const signature = (list: SftpEntry[]) =>
    list.map((e) => `${e.name}:${e.size}:${e.modified}:${e.mode}`).join('|')

  const refresh = useCallback(
    async (target: string, quiet = false) => {
      if (!quiet) setBusy(true)
      try {
        const next = await window.api.sftp.list(tabId, target)
        // Replacing the array unconditionally would clear the selection and
        // fight the scroll position on every poll.
        setEntries((current) => (signature(current) === signature(next) ? current : next))
        setSelected((current) =>
          current && !next.some((e) => e.path === current.path) ? null : current
        )
        setError(null)
      } catch (err) {
        if (!quiet) {
          setError(err instanceof Error ? err.message : String(err))
          setEntries([])
        }
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [tabId]
  )

  useEffect(() => {
    void refresh(path)
  }, [path, refresh])

  /**
   * Keep the listing in step with what you do in the terminal beside it.
   *
   * Re-reading the whole directory every couple of seconds would re-transfer
   * the listing over SSH for nothing, so each tick stats the directory instead
   * — one small round trip — and only re-lists when its mtime moves, which is
   * exactly what creating, deleting or renaming an entry does. Polling pauses
   * while the app is in the background, while an SFTP operation is running, and
   * while a transfer is in flight.
   */
  useEffect(() => {
    if (!autoRefresh) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastMtime: number | null = null

    const idle = () => !document.hidden && document.hasFocus()

    const tick = async () => {
      if (cancelled) return

      if (idle() && !opBusyRef.current && !transferRef.current) {
        try {
          const stats = await window.api.sftp.stat(tabId, path)
          if (cancelled) return
          if (lastMtime !== null && stats.mtime !== lastMtime) {
            await refresh(path, true)
          }
          lastMtime = stats.mtime
        } catch {
          // Directory vanished or the channel is busy; the next tick retries.
        }
      }

      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    timer = setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [autoRefresh, path, refresh, tabId])

  // Live progress while a recursive folder download runs.
  useEffect(
    () =>
      window.api.sftp.onProgress((p) => {
        if (p.tabId !== tabId) return
        setTransfer(p)
        transferRef.current = !p.finished
        // Leave the outcome on screen briefly, then clear it.
        if (p.finished) setTimeout(() => setTransfer(null), p.error ? 8000 : 4000)
      }),
    [tabId]
  )

  /** Run an SFTP mutation, surface failures, and reload the listing. */
  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      await refresh(path)
    },
    [path, refresh]
  )

  const parent = path.replace(/\/[^/]+\/?$/, '') || '/'

  // --- operations ---------------------------------------------------------

  const download = (entry: SftpEntry) =>
    void exclusive(async () => {
      try {
        if (entry.type === 'directory') await window.api.sftp.downloadFolder(tabId, entry)
        else await window.api.sftp.download(tabId, entry)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

  const downloadFolder = (entry: SftpEntry) =>
    void exclusive(async () => {
      try {
        await window.api.sftp.downloadFolder(tabId, entry)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

  const upload = () => void exclusive(() => guard(() => window.api.sftp.upload(tabId, path)))

  const newFolder = () =>
    void exclusive(async () => {
      const name = await ask({
        title: 'New folder',
        label: `Create inside ${path}`,
        confirmLabel: 'Create'
      })
      if (name) await guard(() => window.api.sftp.mkdir(tabId, joinPath(path, name)))
    })

  const newFile = () =>
    void exclusive(async () => {
      const name = await ask({
        title: 'New file',
        label: `Create inside ${path}`,
        confirmLabel: 'Create'
      })
      if (name) await guard(() => window.api.sftp.touch(tabId, joinPath(path, name)))
    })

  const rename = (entry: SftpEntry) =>
    void exclusive(async () => {
      const name = await ask({
        title: 'Rename',
        label: `New name for "${entry.name}"`,
        initial: entry.name,
        confirmLabel: 'Rename'
      })
      if (name && name !== entry.name) {
        await guard(() => window.api.sftp.rename(tabId, entry.path, joinPath(path, name)))
      }
    })

  const remove = (entry: SftpEntry) =>
    void exclusive(async () => {
      if (entry.type !== 'directory') {
        if (window.confirm(`Delete file "${entry.name}"?`)) {
          await guard(() => window.api.sftp.remove(tabId, entry))
        }
        return
      }

      // Deleting a folder is recursive, so say how much is about to go. The
      // count is a round trip, which is exactly the window a second click used
      // to slip through — hence the exclusive wrapper around the whole thing.
      let count: number | null = null
      try {
        count = await window.api.sftp.count(tabId, entry)
      } catch {
        count = null
      }

      const detail =
        count === null
          ? 'and everything inside it'
          : count === 0
            ? '(empty)'
            : `and the ${count} item${count === 1 ? '' : 's'} inside it`

      if (window.confirm(`Delete folder "${entry.name}" ${detail}?\n\nThis cannot be undone.`)) {
        await guard(() => window.api.sftp.remove(tabId, entry))
      }
    })

  const copy = (text: string) => void navigator.clipboard.writeText(text)

  const activate = (entry: SftpEntry) => {
    if (entry.type === 'directory') setPath(entry.path)
    else setEditing(entry.path)
  }

  // --- context menu -------------------------------------------------------

  const menuItems = (entry: SftpEntry | null): MenuItem[] => {
    if (!entry) {
      // Right-click on empty space acts on the directory itself.
      return [
        { label: 'Upload files here…', onClick: upload },
        {},
        { label: 'New folder…', onClick: newFolder },
        { label: 'New file…', onClick: newFile },
        {},
        { label: 'Copy folder path', onClick: () => copy(path) },
        { label: 'Refresh', onClick: () => void refresh(path) }
      ]
    }

    const isDir = entry.type === 'directory'
    return [
      isDir
        ? { label: 'Open folder', onClick: () => setPath(entry.path) }
        : { label: 'Open with embedded editor', onClick: () => setEditing(entry.path) },
      isDir
        ? { label: 'Download folder…', onClick: () => downloadFolder(entry) }
        : { label: 'Download…', onClick: () => download(entry) },
      {},
      { label: 'Rename…', onClick: () => rename(entry) },
      { label: 'Delete', onClick: () => remove(entry), danger: true },
      {},
      { label: 'Copy name', onClick: () => copy(entry.name) },
      { label: 'Copy full path', onClick: () => copy(entry.path) },
      {},
      { label: 'Upload files here…', onClick: upload },
      { label: 'New folder…', onClick: newFolder },
      { label: 'New file…', onClick: newFile },
      {},
      { label: 'Permissions & properties…', onClick: () => setProperties(entry) },
      { label: 'Refresh', onClick: () => void refresh(path) }
    ]
  }

  const openMenu = (event: React.MouseEvent, entry: SftpEntry | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (entry) setSelected(entry)
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }

  // --- render -------------------------------------------------------------

  return (
    <div className="filepane">
      <div className="filepane-toolbar">
        <button
          className="icon-btn"
          onClick={() => setPath(parent)}
          disabled={opBusy}
          title="Parent directory"
        >
          <IconGoUp />
        </button>
        <button
          className="icon-btn"
          onClick={() => selected && download(selected)}
          disabled={!selected || opBusy}
          title={
            selected?.type === 'directory'
              ? 'Download selected folder (recursive)'
              : 'Download selected file'
          }
        >
          <IconDownload />
        </button>
        <button className="icon-btn" onClick={upload} disabled={opBusy} title="Upload files to this folder">
          <IconUpload />
        </button>
        <button className="icon-btn" onClick={() => void refresh(path)} disabled={opBusy} title="Refresh">
          <IconRefresh />
        </button>
        <span className="toolbar-sep" />
        <button className="icon-btn" onClick={newFile} disabled={opBusy} title="New file">
          <IconNewFile />
        </button>
        <button className="icon-btn" onClick={newFolder} disabled={opBusy} title="New folder">
          <IconNewFolder />
        </button>
        <button
          className="icon-btn"
          onClick={() => selected && remove(selected)}
          disabled={!selected || opBusy}
          title="Delete selected"
        >
          <IconDelete />
        </button>
      </div>

      <form
        className="filepane-pathbar"
        onSubmit={(e) => {
          e.preventDefault()
          setPath(pathDraft.trim() || '.')
        }}
      >
        <input
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          spellCheck={false}
          title={path}
        />
        <button className="icon-btn" type="submit" title="Go to this path">
          <IconCheck />
        </button>
      </form>

      <div className="filepane-header">
        <span>Name</span>
        <span className="col-size">Size</span>
      </div>

      {error ? (
        <div className="filepane-error">{error}</div>
      ) : (
        <div className="filepane-list" onContextMenu={(e) => openMenu(e, null)}>
          <button className="file-row" onDoubleClick={() => setPath(parent)}>
            <span className="glyph">📁</span>
            <span className="fname">..</span>
          </button>

          {entries.map((entry) => (
            <button
              key={entry.path}
              className={`file-row${selected?.path === entry.path ? ' selected' : ''}`}
              onClick={() => setSelected(entry)}
              onDoubleClick={() => activate(entry)}
              onContextMenu={(e) => openMenu(e, entry)}
              title={`${entry.path}\n${modeToRwx(entry.mode)}  ${formatSize(entry.size)}`}
            >
              <span className="glyph">
                {entry.type === 'directory' ? '📁' : entry.type === 'symlink' ? '↗' : '📄'}
              </span>
              <span className="fname">{entry.name}</span>
              {entry.type === 'file' && <span className="size">{formatSize(entry.size)}</span>}
            </button>
          ))}

          {!entries.length && !busy && <div className="muted-row">Empty directory</div>}
        </div>
      )}

      {transfer && <TransferBar progress={transfer} />}

      {promptDialog}

      <div className="filepane-footer">
        <label className="filepane-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow terminal folder
        </label>
        <label
          className="filepane-follow"
          title="Re-list when the folder changes on the server, e.g. after deleting in the terminal"
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}

      {editing && (
        <RemoteEditor tabId={tabId} path={editing} onClose={() => setEditing(null)} />
      )}

      {properties && (
        <FileProperties
          tabId={tabId}
          entry={properties}
          onClose={() => setProperties(null)}
          onChanged={() => void refresh(path)}
        />
      )}
    </div>
  )
}
