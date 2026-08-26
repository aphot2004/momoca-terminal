import type { EventEmitter } from 'node:events'
import type { SFTPWrapper } from 'ssh2'

/**
 * Common surface for anything that can back a terminal tab, so the IPC layer
 * doesn't care whether it's talking to a local pty or an SSH channel.
 *
 * Events: `data` (string), `exit` ({ code, signal }), `error` (Error).
 */
export interface TerminalBackend extends EventEmitter {
  write(data: string): void
  resize(cols: number, rows: number): void
  dispose(): void
  /** Resolves once an SFTP channel is up, or null for backends without one. */
  sftp(): Promise<SFTPWrapper | null>
}
