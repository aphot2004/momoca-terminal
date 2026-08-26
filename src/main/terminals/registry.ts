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
    if (!sender.isDestroyed()) sender.send('term:data', { tabId, data })
  })
  backend.on('exit', ({ code, signal }: { code: number | null; signal?: string }) => {
    terminals.delete(tabId)
    pollers.get(tabId)?.stop()
    pollers.delete(tabId)
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
    poller.start()
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
  pollers.get(tabId)?.stop()
  pollers.delete(tabId)
  terminals.get(tabId)?.dispose()
  terminals.delete(tabId)
}

export function disposeAll(): void {
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
