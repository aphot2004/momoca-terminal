import type { WebContents } from 'electron'
import type { ConnectOptions, SavedSession } from '@shared/types'
import { createPrompter } from '../prompts'
import { RemoteStatsPoller } from '../ssh/remote-stats'
import { SshTerminal } from '../ssh/ssh-terminal'
import { getSession } from '../store/sessions'
import { revealSecret } from '../store/secrets'
import type { TerminalBackend } from './backend'
import { LocalTerminal } from './local'
import { SerialTerminal } from './serial'
import { TelnetTerminal } from './telnet'

const terminals = new Map<string, TerminalBackend>()
/** Stats pollers keyed by tab, torn down with their terminal. */
const pollers = new Map<string, RemoteStatsPoller>()
/** Set by stats-poll when the diagnostics bar goes away; new pollers inherit it. */
let remoteStatsPaused = false

/** Pause or resume every server-side metrics poll at once. */
export function setRemoteStatsPaused(paused: boolean): void {
  if (paused === remoteStatsPaused) return
  remoteStatsPaused = paused
  for (const poller of pollers.values()) poller.setPaused(paused)
}

/**
 * The shortest gap between two `term:data` messages for one tab.
 *
 * Under a fast `cat` the pty hands us ~224-byte chunks about 28,000 times a
 * second, and each one used to be its own IPC message and its own `term.write`
 * — for output the screen can only repaint 60 times a second anyway.
 *
 * So this is a rate limit, not a delay: the first chunk after a quiet moment
 * goes out immediately, which is every keystroke echo and every prompt, and
 * only a terminal already producing faster than this starts batching. A
 * `seq 1 200000` drops from 6,652 messages to 57 with no change to echo
 * latency (measured p50 2.7ms either way).
 */
const FLUSH_MS = 4
/** Never let the buffer grow past this before sending, so memory stays bounded. */
const FLUSH_BYTES = 64 * 1024

/** Output waiting to be sent for one tab, and when that tab last sent. */
interface Outbox {
  chunks: string[]
  size: number
  timer: NodeJS.Timeout | null
  lastSend: number
}
const outboxes = new Map<string, Outbox>()

function flush(tabId: string, sender: WebContents): void {
  const outbox = outboxes.get(tabId)
  if (!outbox) return
  if (outbox.timer) clearTimeout(outbox.timer)
  outbox.timer = null
  if (!outbox.chunks.length) return

  const data = outbox.chunks.join('')
  outbox.chunks = []
  outbox.size = 0
  outbox.lastSend = performance.now()
  if (!sender.isDestroyed()) sender.send('term:data', { tabId, data })
}

/** Send this chunk now if the tab has been quiet, otherwise ride the next flush. */
function queue(tabId: string, sender: WebContents, data: string): void {
  let outbox = outboxes.get(tabId)
  if (!outbox) {
    outbox = { chunks: [], size: 0, timer: null, lastSend: -Infinity }
    outboxes.set(tabId, outbox)
  }

  outbox.chunks.push(data)
  outbox.size += data.length

  const since = performance.now() - outbox.lastSend
  if ((!outbox.timer && since >= FLUSH_MS) || outbox.size >= FLUSH_BYTES) {
    flush(tabId, sender)
    return
  }
  outbox.timer ??= setTimeout(() => flush(tabId, sender), Math.max(0, FLUSH_MS - since))
}

export function get(tabId: string): TerminalBackend | undefined {
  return terminals.get(tabId)
}

function resolveSession(options: ConnectOptions): SavedSession {
  if (options.sessionId) {
    const saved = getSession(options.sessionId)
    if (!saved) throw new Error(`Unknown session ${options.sessionId}`)
    return saved
  }
  if (!options.session) throw new Error('connect requires either sessionId or session')
  return { ...options.session, id: `adhoc-${options.tabId}` }
}

/** Build the right backend for a session's protocol. */
async function createBackend(
  session: SavedSession,
  options: ConnectOptions,
  sender: WebContents
): Promise<TerminalBackend> {
  const { tabId, cols, rows } = options

  switch (session.kind) {
    case 'local':
      return new LocalTerminal(session, cols, rows)

    case 'telnet':
      return new TelnetTerminal(session, cols, rows)

    case 'serial':
      return new SerialTerminal(session)

    case 'mosh': {
      // mosh drives ssh itself, so it runs as a plain local pty process.
      const target = session.username ? `${session.username}@${session.host}` : session.host!
      const args = session.port && session.port !== 22 ? [`--ssh=ssh -p ${session.port}`] : []
      return new LocalTerminal(session, cols, rows, { file: 'mosh', args: [...args, target] })
    }

    case 'ftp': {
      const args = [session.host!]
      if (session.port && session.port !== 21) args.push(String(session.port))
      return new LocalTerminal(session, cols, rows, { file: 'ftp', args })
    }

    case 'rsh': {
      const args = session.username ? ['-l', session.username, session.host!] : [session.host!]
      return new LocalTerminal(session, cols, rows, { file: 'rsh', args })
    }

    case 'ssh':
    case 'sftp':
      return SshTerminal.connect(
        session,
        cols,
        rows,
        createPrompter(sender, tabId),
        (vaultId) => revealSecret(vaultId),
        // An SFTP session skips the shell channel entirely.
        { shell: session.kind !== 'sftp' }
      )

    default:
      // External kinds are launched via external-tools, never as a tab.
      throw new Error(`${session.kind} sessions open in another application`)
  }
}

export async function create(options: ConnectOptions, sender: WebContents): Promise<void> {
  if (terminals.has(options.tabId)) throw new Error(`Tab ${options.tabId} already exists`)

  const session = resolveSession(options)
  const { tabId } = options

  const backend = await createBackend(session, options, sender)

  terminals.set(tabId, backend)

  backend.on('data', (data: string) => {
    if (!sender.isDestroyed()) queue(tabId, sender, data)
  })
  backend.on('exit', ({ code, signal }: { code: number | null; signal?: string }) => {
    terminals.delete(tabId)
    pollers.get(tabId)?.stop()
    pollers.delete(tabId)
    // Whatever the shell printed on its way out belongs on screen before the
    // closing notice, so the buffer goes first.
    flush(tabId, sender)
    outboxes.delete(tabId)
    if (!sender.isDestroyed()) sender.send('term:exit', { tabId, code, signal })
  })
  backend.on('error', (err: Error) => {
    if (!sender.isDestroyed()) {
      sender.send('term:status', { tabId, status: 'error', error: err.message })
    }
  })

  // Poll the *server's* metrics for SSH tabs — the diagnostics bar should
  // describe the machine you're working on, not the laptop it's shown from.
  if (backend instanceof SshTerminal && backend.connection) {
    const label = `${session.username ?? ''}@${session.host ?? ''}`.replace(/^@/, '')
    const poller = new RemoteStatsPoller(backend.connection, tabId, sender, label || session.name)
    pollers.set(tabId, poller)
    if (remoteStatsPaused) poller.setPaused(true)
    else poller.start()
  }

  const sftp = await backend.sftp()
  if (!sender.isDestroyed()) {
    sender.send('term:status', { tabId, status: 'ready', sftp: sftp !== null })
  }
}

export function write(tabId: string, data: string): void {
  terminals.get(tabId)?.write(data)
}

export function resize(tabId: string, cols: number, rows: number): void {
  terminals.get(tabId)?.resize(cols, rows)
}

export function close(tabId: string): void {
  const pending = outboxes.get(tabId)
  if (pending?.timer) clearTimeout(pending.timer)
  outboxes.delete(tabId)
  pollers.get(tabId)?.stop()
  pollers.delete(tabId)
  terminals.get(tabId)?.dispose()
  terminals.delete(tabId)
}

export function disposeAll(): void {
  for (const outbox of outboxes.values()) if (outbox.timer) clearTimeout(outbox.timer)
  outboxes.clear()
  for (const poller of pollers.values()) poller.stop()
  pollers.clear()
  for (const backend of terminals.values()) backend.dispose()
  terminals.clear()
}

/** Throws a clear error rather than a null-deref when a tab has no SFTP channel. */
export async function requireSftp(tabId: string) {
  const backend = terminals.get(tabId)
  if (!backend) throw new Error('Terminal is no longer open')
  const sftp = await backend.sftp()
  if (!sftp) throw new Error('This tab has no SFTP channel')
  return sftp
}
