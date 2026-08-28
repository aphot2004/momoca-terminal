/** Types shared across main, preload and renderer. Keep this file dependency-free. */

/**
 * Session protocols. `sftp` opens an SSH connection for the file browser only,
 * with no shell channel — MobaXterm's SFTP-session equivalent.
 */
export type SessionKind =
  | 'ssh'
  | 'local'
  | 'telnet'
  | 'serial'
  | 'mosh'
  | 'sftp'
  | 'ftp'
  | 'rsh'
  | 'rdp'
  | 'vnc'
  | 'browser'
  | 'xdmcp'

/** Session kinds that hand off to another app instead of opening a terminal tab. */
export const EXTERNAL_KINDS: SessionKind[] = ['rdp', 'vnc', 'browser', 'xdmcp']

export type ToolId = 'vnc' | 'browser' | 'mosh' | 'freerdp' | 'xquartz' | 'ftp' | 'rsh'

/**
 * External client each session type needs. Kinds absent from this map are
 * served in-process (SSH, SFTP, Telnet, Serial, Shell) and always available.
 * Single source of truth so the session picker and the launcher can't disagree
 * about what is usable.
 */
export const KIND_REQUIREMENT: Partial<Record<SessionKind, ToolId>> = {
  mosh: 'mosh',
  ftp: 'ftp',
  rsh: 'rsh',
  rdp: 'freerdp',
  vnc: 'vnc',
  browser: 'browser',
  xdmcp: 'xquartz'
}

/** Availability of an external dependency, with install guidance when missing. */
export interface ToolCheck {
  id: ToolId
  name: string
  purpose: string
  available: boolean
  /** Path or app bundle we found. */
  detail?: string
  install?: {
    summary: string
    steps: { label: string; command?: string }[]
    url?: string
  }
}

export type AuthMethod = 'agent' | 'key' | 'password'

/** A private key copied into the app's own store, rather than referenced on disk. */
export interface ImportedKey {
  id: string
  name: string
  /** e.g. "ssh-ed25519" — read from the key itself, not the filename. */
  type: string
  fingerprint: string
  /** True when the key file is passphrase-protected. */
  encrypted: boolean
  /** OpenSSH one-liner, for pasting into a server's authorized_keys. */
  publicKey: string
  importedAt: number
}

export interface SavedSession {
  id: string
  name: string
  kind: SessionKind
  /** Grouping path in the sidebar tree, e.g. "Work/Prod". Empty string = root. */
  folder: string
  host?: string
  port?: number
  username?: string
  authMethod?: AuthMethod
  /** An imported key from the app's key store; takes precedence over privateKeyPath. */
  keyId?: string
  /** A key referenced in place on disk, e.g. ~/.ssh/id_ed25519. */
  privateKeyPath?: string
  /** Inject a PROMPT_COMMAND/precmd hook so the file pane follows `cd`. */
  trackCwd?: boolean
  /** Shell to launch for kind === 'local'. Defaults to $SHELL. */
  shell?: string
  /** Serial device path, e.g. /dev/tty.usbserial-1420. */
  serialPath?: string
  baudRate?: number
  /** Commands run once the shell is interactive. */
  initCommands?: string[]
}

/**
 * Port forwarding, matching ssh's -L / -R / -D.
 *  - local:   listen here, forward to destination as seen from the server
 *  - remote:  listen on the server, forward back to a destination we can reach
 *  - dynamic: a SOCKS5 proxy here, destinations chosen per-connection by the client
 */
export type TunnelType = 'local' | 'remote' | 'dynamic'

export interface Tunnel {
  id: string
  name: string
  type: TunnelType
  /** Saved SSH session this tunnel connects through. */
  sessionId: string
  listenHost: string
  listenPort: number
  /** Unused for `dynamic`, where the client picks the destination. */
  destHost?: string
  destPort?: number
  autoStart?: boolean
}

export interface TunnelStatus {
  id: string
  state: 'stopped' | 'starting' | 'running' | 'error'
  error?: string
  /** Connections handled since this tunnel last started. */
  connections: number
}

export type TransferKind = 'download' | 'upload' | 'delete'

/** Live progress for a multi-file SFTP operation, pushed from main. */
export interface TransferProgress {
  tabId: string
  kind: TransferKind
  /** Items finished, and how many the pre-walk found. */
  done: number
  total: number
  /** Name of the file currently being worked on. */
  current: string
  /** Byte counters; zero for deletes, which move no data. */
  bytes: number
  totalBytes: number
  bytesPerSecond: number
  /** Set on the final event; the operation is over. */
  finished?: boolean
  /** Human-readable outcome, present with `finished`. */
  summary?: string
  error?: string
}

// --- network tools ---------------------------------------------------------

export interface PortResult {
  port: number
  /** `closed` means actively refused, which still proves the host is up. */
  state: 'open' | 'closed' | 'filtered'
  service?: string
  ms: number
}

export interface ScanTarget {
  host: string
  /** "22,80,8000-8010" */
  ports: string
  timeoutMs?: number
  concurrency?: number
}

export interface PingSample {
  seq: number
  ttl: number
  /** null for a timed-out probe. */
  ms: number | null
}

export interface PingSummary {
  sent: number
  received: number
  loss: number
  min: number | null
  avg: number | null
  max: number | null
}

export interface DiscoveredHost {
  ip: string
  /** How it answered: ICMP echo, or an open TCP port when ICMP was ignored. */
  via: 'icmp' | 'tcp'
  ms: number | null
  hostname?: string
  mac?: string
}

// --- macros ----------------------------------------------------------------

/**
 * A recorded burst of terminal input. `data` is exactly the bytes that were
 * typed, so control characters and escape sequences replay faithfully.
 */
export interface MacroStep {
  data: string
  /** Milliseconds waited before this step, as recorded. */
  delay: number
}

export interface Macro {
  id: string
  name: string
  steps: MacroStep[]
  createdAt: number
  /**
   * Multiplier applied to each step's recorded delay. 1 replays at the speed it
   * was typed, 2 is twice as fast, 0.5 half. `0` means "as fast as the shell
   * will take it", keeping only a token gap between steps.
   */
  speed?: number
  /** Superseded by `speed`; still read so older macros keep working. */
  useRecordedTiming?: boolean
}

/** Playback speeds offered in the UI. */
export const MACRO_SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant' },
  { value: 4, label: '4× faster' },
  { value: 2, label: '2× faster' },
  { value: 1, label: 'As recorded' },
  { value: 0.5, label: 'Half speed' }
]

/** One macro run against one terminal. */
export interface MacroRunTarget {
  tabId: string
  title: string
}

// --- toolbox ---------------------------------------------------------------

export interface ProcessInfo {
  pid: number
  ppid: number
  user: string
  /** Percent of one CPU. */
  cpu: number
  mem: number
  rss: number
  elapsed: string
  command: string
}

export interface HardwareInfo {
  model: string
  cpu: string
  cores: number
  memoryBytes: number
  osVersion: string
  osBuild: string
  bootTime: string
  disks: { name: string; sizeBytes: number; freeBytes: number; fs: string }[]
  gpus: string[]
}

export interface ListeningPort {
  command: string
  pid: number
  user: string
  address: string
  port: number
  protocol: string
}

export interface BrewPackage {
  name: string
  version: string
  outdated: boolean
}

// --- unix tools ------------------------------------------------------------

export type UnixToolGroup = 'files' | 'text' | 'network' | 'system' | 'archives' | 'gnu'

export interface UnixTool {
  name: string
  group: UnixToolGroup
  purpose: string
  available: boolean
  path?: string
  version?: string
  /** Homebrew formula when it isn't part of macOS. */
  formula?: string
  /** Where the BSD variant differs from what Linux docs assume. */
  bsdCaveat?: string
}

/** How stored credentials are protected, and whether they're readable right now. */
export interface VaultStatus {
  /** `keychain` uses the macOS login Keychain; `master` uses a password you set. */
  mode: 'keychain' | 'master'
  /** True only in master mode before the password has been entered this run. */
  locked: boolean
  secretCount: number
  keychainAvailable: boolean
}

/** Metrics for the server behind an SSH tab, polled over an exec channel. */
export interface RemoteStats {
  /** user@host label for the bar. */
  host: string
  /** `uname -s` — "Linux", "Darwin", … */
  os: string
  cpu: { usage: number; cores: number }
  memory: { used: number; total: number }
  disk: { used: number; total: number; mount: string }
  network: { rx: number; tx: number }
  load: [number, number, number]
  uptime: number
  detail?: StatsDetail
}

/**
 * The detail behind each meter, shown on hover.
 *
 * Gathered on the same poll as the summary, because a probe fired on mouse-over
 * would arrive after the pointer had moved on. Every field is optional: a host
 * that cannot answer one question still answers the others, and the popover
 * shows what it has rather than failing whole.
 */
export interface StatsDetail {
  /** Per-core busy percentage, in core order. */
  cores?: number[]
  /** Top processes by resident memory, largest first. */
  topMemory?: { name: string; pid: number; bytes: number }[]
  /** Top processes by CPU share, largest first. */
  topCpu?: { name: string; pid: number; percent: number }[]
  /** Every mounted filesystem worth showing. */
  volumes?: { mount: string; device?: string; used: number; total: number }[]
  /** Cumulative disk throughput since boot, in bytes. */
  diskIo?: { read: number; written: number }
  /** Per-interface counters, cumulative bytes since boot. */
  interfaces?: { name: string; rx: number; tx: number; address?: string }[]
}

/** Host metrics for the diagnostics bar. Byte counts are absolute; network is bytes/sec. */
export interface SystemStats {
  cpu: { usage: number; cores: number; model: string }
  memory: { used: number; total: number }
  disk: { used: number; total: number; mount: string }
  network: { rx: number; tx: number }
  load: [number, number, number]
  uptime: number
  detail?: StatsDetail
}

/** A live terminal tab. `tabId` is generated by the renderer and is the key for all IPC. */
export interface TabState {
  tabId: string
  sessionId: string | null
  title: string
  kind: SessionKind
  status: 'connecting' | 'ready' | 'closed' | 'error'
  error?: string
  /** Present only for SSH tabs that negotiated an SFTP channel. */
  sftp: boolean
  cwd: string
}

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  /** Unix mtime in milliseconds. */
  modified: number
  mode: number
}

export interface ConnectOptions {
  tabId: string
  sessionId?: string
  /** Ad-hoc connection details, used when sessionId is absent. */
  session?: Omit<SavedSession, 'id'>
  cols: number
  rows: number
}

/** Credentials are requested lazily by main and never persisted in the renderer. */
export interface CredentialPrompt {
  tabId: string
  kind: 'password' | 'passphrase' | 'keyboard-interactive'
  title: string
  prompts: { prompt: string; echo: boolean }[]
}

export type MainToRenderer = {
  'term:data': { tabId: string; data: string }
  'term:exit': { tabId: string; code: number | null; signal?: string }
  'term:status': { tabId: string; status: TabState['status']; error?: string; sftp?: boolean }
  'cred:request': CredentialPrompt
}
