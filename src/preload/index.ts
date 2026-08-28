import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BrewPackage,
  ConnectOptions,
  DiscoveredHost,
  HardwareInfo,
  ListeningPort,
  ProcessInfo,
  ImportedKey,
  Macro,
  PingSample,
  PingSummary,
  PortResult,
  ScanTarget,
  UnixTool,
  RemoteStats,
  SavedSession,
  SftpEntry,
  SystemStats,
  ToolCheck,
  TransferProgress,
  VaultStatus,
  ToolId,
  Tunnel,
  TunnelStatus
} from '@shared/types'

type ImportResult =
  | { status: 'ok'; key: ImportedKey }
  | { status: 'needs-passphrase' }
  | { status: 'error'; message: string }

type Envelope<T> = { ok: true; value: T } | { ok: false; error: string }

/** Unwrap the main-process result envelope so callers see a normal rejection. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  sessions: {
    list: () => invoke<SavedSession[]>('sessions:list'),
    save: (session: SavedSession) => invoke<SavedSession>('sessions:save', session),
    remove: (id: string) => invoke<void>('sessions:delete', id)
  },

  vault: {
    status: () => invoke<VaultStatus>('vault:status'),
    unlock: (password: string) => invoke<boolean>('vault:unlock', password),
    lock: () => invoke<void>('vault:lock'),
    setMaster: (next: string | null) => invoke<void>('vault:setMaster', next)
  },

  secrets: {
    available: () => invoke<boolean>('secrets:available'),
    has: (key: string) => invoke<boolean>('secrets:has', key),
    store: (key: string, value: string) => invoke<void>('secrets:store', key, value),
    remove: (key: string) => invoke<void>('secrets:delete', key)
  },

  keys: {
    list: () => invoke<ImportedKey[]>('keys:list'),
    import: (input: {
      path?: string
      text?: string
      name?: string
      passphrase?: string
      rememberPassphrase?: boolean
    }) => invoke<ImportResult>('keys:import', input),
    rename: (id: string, name: string) => invoke<void>('keys:rename', id, name),
    remove: (id: string) => invoke<void>('keys:delete', id),
    pickFile: () => invoke<string | null>('keys:pickFile')
  },

  term: {
    create: (options: ConnectOptions) => invoke<void>('term:create', options),
    write: (tabId: string, data: string) => invoke<void>('term:write', tabId, data),
    resize: (tabId: string, cols: number, rows: number) =>
      invoke<void>('term:resize', tabId, cols, rows),
    close: (tabId: string) => invoke<void>('term:close', tabId),

    onData: (handler: (p: { tabId: string; data: string }) => void) =>
      subscribe('term:data', handler),
    onExit: (handler: (p: { tabId: string; code: number | null }) => void) =>
      subscribe('term:exit', handler),
    onStatus: (
      handler: (p: { tabId: string; status: string; error?: string; sftp?: boolean }) => void
    ) => subscribe('term:status', handler)
  },

  sftp: {
    list: (tabId: string, path: string) => invoke<SftpEntry[]>('sftp:list', tabId, path),
    read: (tabId: string, path: string) => invoke<string>('sftp:read', tabId, path),
    write: (tabId: string, path: string, contents: string) =>
      invoke<void>('sftp:write', tabId, path, contents),
    mkdir: (tabId: string, path: string) => invoke<void>('sftp:mkdir', tabId, path),
    touch: (tabId: string, path: string) => invoke<void>('sftp:touch', tabId, path),
    chmod: (tabId: string, path: string, mode: number) =>
      invoke<void>('sftp:chmod', tabId, path, mode),
    stat: (tabId: string, path: string) =>
      invoke<{
        size: number
        mode: number
        uid: number
        gid: number
        atime: number
        mtime: number
      }>('sftp:stat', tabId, path),
    rename: (tabId: string, from: string, to: string) =>
      invoke<void>('sftp:rename', tabId, from, to),
    remove: (tabId: string, entry: SftpEntry) =>
      invoke<{ removed: number }>('sftp:remove', tabId, entry),
    count: (tabId: string, entry: SftpEntry) => invoke<number>('sftp:count', tabId, entry),
    download: (tabId: string, entry: SftpEntry) => invoke<string | null>('sftp:download', tabId, entry),
    downloadFolder: (tabId: string, entry: SftpEntry) =>
      invoke<{
        destination: string
        files: number
        bytes: number
        skipped: string[]
        skippedCount: number
      } | null>(
        'sftp:downloadFolder',
        tabId,
        entry
      ),
    upload: (tabId: string, remoteDir: string) => invoke<string[]>('sftp:upload', tabId, remoteDir),
    uploadFolder: (tabId: string, remoteDir: string) =>
      invoke<{ files: number; bytes: number; skipped: string[]; skippedCount: number } | null>(
        'sftp:uploadFolder',
        tabId,
        remoteDir
      ),
    onProgress: (handler: (p: TransferProgress) => void) => subscribe('sftp:progress', handler)
  },

  tools: {
    check: () => invoke<ToolCheck[]>('tools:check'),
    launch: (session: SavedSession) =>
      invoke<{ launched: boolean; message: string; tool?: ToolId }>('tools:launch', session),
    startXServer: () =>
      invoke<{ launched: boolean; message: string; tool?: ToolId }>('tools:startXServer')
  },

  tunnels: {
    list: () => invoke<Tunnel[]>('tunnels:list'),
    save: (tunnel: Tunnel) => invoke<Tunnel>('tunnels:save', tunnel),
    remove: (id: string) => invoke<void>('tunnels:delete', id),
    status: () => invoke<TunnelStatus[]>('tunnels:status'),
    start: (id: string) => invoke<void>('tunnels:start', id),
    stop: (id: string) => invoke<void>('tunnels:stop', id),
    onStatus: (handler: (statuses: TunnelStatus[]) => void) =>
      subscribe('tunnels:status', handler)
  },

  stats: {
    onUpdate: (handler: (stats: SystemStats) => void) => subscribe('stats:update', handler),
    /** Per-tab metrics for the server behind an SSH session. */
    onRemote: (handler: (p: { tabId: string; stats: RemoteStats }) => void) =>
      subscribe('stats:remote', handler)
  },

  net: {
    scan: (target: ScanTarget) => invoke<{ jobId: string }>('net:scan', target),
    ping: (host: string, count: number) => invoke<{ jobId: string }>('net:ping', host, count),
    discover: (cidr: string) => invoke<{ jobId: string }>('net:discover', cidr),
    cancel: (jobId: string) => invoke<void>('net:cancel', jobId),
    localNetworks: () =>
      invoke<{ cidr: string; address: string; iface: string }[]>('net:localNetworks'),
    commonPorts: () => invoke<number[]>('net:commonPorts'),

    onScan: (
      handler: (p: {
        jobId: string
        done: number
        total: number
        result?: PortResult
        finished?: boolean
        cancelled?: boolean
        open?: PortResult[]
      }) => void
    ) => subscribe('net:scan', handler),
    onPing: (
      handler: (p: {
        jobId: string
        sample?: PingSample
        total?: number
        finished?: boolean
        cancelled?: boolean
        error?: string
        summary?: PingSummary
      }) => void
    ) => subscribe('net:ping', handler),
    onDiscover: (
      handler: (p: {
        jobId: string
        done: number
        total: number
        host?: DiscoveredHost
        finished?: boolean
        cancelled?: boolean
        hosts?: DiscoveredHost[]
      }) => void
    ) => subscribe('net:discover', handler)
  },

  macros: {
    list: () => invoke<Macro[]>('macros:list'),
    save: (macro: Macro | Omit<Macro, 'id'>) => invoke<Macro>('macros:save', macro),
    remove: (id: string) => invoke<void>('macros:delete', id)
  },

  unix: {
    check: () => invoke<UnixTool[]>('unix:check')
  },

  toolbox: {
    processes: () => invoke<ProcessInfo[]>('tool:processes'),
    kill: (pid: number, signal: string) => invoke<void>('tool:kill', pid, signal),
    hardware: () => invoke<HardwareInfo>('tool:hardware'),
    ports: () => invoke<ListeningPort[]>('tool:ports'),
    wol: (mac: string, broadcast: string, port: number) =>
      invoke<void>('tool:wol', mac, broadcast, port),
    genKey: (input: {
      type: 'ed25519' | 'rsa' | 'ecdsa'
      bits?: number
      comment?: string
      passphrase?: string
    }) => invoke<{ privateKey: string; publicKey: string; fingerprint: string }>('tool:genKey', input),
    readFile: (path: string) => invoke<string>('tool:readFile', path),
    writeFile: (path: string, contents: string) => invoke<void>('tool:writeFile', path, contents),
    diff: (left: string, right: string) => invoke<string>('tool:diff', left, right),
    brew: () => invoke<{ available: boolean; packages: BrewPackage[] }>('tool:brew'),
    pickFile: (title: string) => invoke<string | null>('tool:pickFile', title),
    saveFile: (defaultPath: string) => invoke<string | null>('tool:saveFile', defaultPath)
  },

  window: {
    setFullScreen: (on: boolean) => invoke<boolean>('window:fullscreen', on),
    minimize: () => invoke<void>('window:minimize'),
    /** Returns where the PNG was written, or null when the save was cancelled. */
    screenshot: () => invoke<string | null>('window:screenshot'),
    printText: (title: string, text: string) => invoke<boolean>('window:printText', title, text)
  },

  serial: {
    list: () => invoke<{ path: string; label: string }[]>('serial:list')
  },

  dialog: {
    pickPrivateKey: () => invoke<string | null>('dialog:pickPrivateKey')
  },

  /** Modal requests originating in main (auth prompts, host-key confirmation). */
  prompts: {
    onSecret: (
      handler: (p: {
        requestId: string
        tabId: string
        kind: 'password' | 'passphrase' | 'keyboard-interactive'
        title: string
        prompts: { prompt: string; echo: boolean }[]
      }) => void
    ) => subscribe('prompt:secret', handler),

    onHostKey: (
      handler: (p: {
        requestId: string
        tabId: string
        host: string
        port: number
        keyType: string
        fingerprint: string
        mismatch: boolean
      }) => void
    ) => subscribe('prompt:hostkey', handler),

    respond: (requestId: string, value: unknown) =>
      ipcRenderer.send('prompt:respond', { requestId, value })
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
