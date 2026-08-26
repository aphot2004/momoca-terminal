import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { SavedSession } from '@shared/types'
import type { TerminalBackend } from './backend'

/**
 * A local shell. Login shells are spawned with `-l` so the user's normal
 * PATH and Homebrew setup are present, matching Terminal.app's behaviour.
 */
export class LocalTerminal extends EventEmitter implements TerminalBackend {
  private proc: pty.IPty | null

  /**
   * `command` overrides the login shell — used by the Mosh session type, which
   * is just the `mosh` client running in a local pty.
   */
  constructor(
    session: Pick<SavedSession, 'shell' | 'initCommands'>,
    cols: number,
    rows: number,
    command?: { file: string; args: string[] }
  ) {
    super()
    const shell = command?.file ?? session.shell ?? process.env.SHELL ?? '/bin/zsh'
    const args = command ? command.args : ['-l']

    this.proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<
        string,
        string
      >
    })

    this.proc.onData((data) => this.emit('data', data))
    this.proc.onExit(({ exitCode, signal }) => {
      this.proc = null
      this.emit('exit', { code: exitCode, signal })
    })

    for (const command of session.initCommands ?? []) {
      this.proc.write(`${command}\n`)
    }
  }

  write(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    // node-pty throws if the process died between the renderer's resize and here.
    try {
      this.proc?.resize(cols, rows)
    } catch {
      /* terminal already gone */
    }
  }

  async sftp(): Promise<null> {
    return null
  }

  dispose(): void {
    try {
      this.proc?.kill()
    } catch {
      /* already exited */
    }
    this.proc = null
  }
}
