import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper, utils } from 'ssh2'
import type { SavedSession } from '@shared/types'
import { getKey, keyFilePath, keyVaultId } from '../store/keys'
import type { TerminalBackend } from '../terminals/backend'
import { trustHostKey, verifyHostKey } from './known-hosts'

/** Everything the backend needs from the UI, injected so this file stays testable. */
export interface SshPrompter {
  askSecret(
    kind: 'password' | 'passphrase' | 'keyboard-interactive',
    title: string,
    prompts: { prompt: string; echo: boolean }[]
  ): Promise<string[] | null>
  confirmHostKey(info: {
    host: string
    port: number
    keyType: string
    fingerprint: string
    mismatch: boolean
  }): Promise<boolean>
}

/**
 * Installed once after login when `trackCwd` is on, so the SFTP pane can follow
 * the shell's working directory via OSC 7. Works in both bash and zsh.
 *
 * The shell echoes this whole line back, which would dump a wall of source into
 * the user's first screen, so it prints `marker` when it's done and the caller
 * swallows everything up to that point. The marker is split by quotes in the
 * source (`"MC""RDY"`) so the echoed copy can't be mistaken for the real one,
 * and the OSC 7 call comes *after* it so the first directory report survives.
 */
function osc7Hook(marker: string): string {
  const half = Math.ceil(marker.length / 2)
  const split = `"${marker.slice(0, half)}""${marker.slice(half)}"`
  return (
    `__mc_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "\${HOSTNAME:-$(hostname)}" "$PWD"; }; ` +
    `if [ -n "$ZSH_VERSION" ]; then autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __mc_osc7; ` +
    `else PROMPT_COMMAND="__mc_osc7;\${PROMPT_COMMAND}"; fi; ` +
    `printf '%s\\n' ${split}; __mc_osc7`
  )
}

export class SshTerminal extends EventEmitter implements TerminalBackend {
  private client: Client | null = null
  private stream: ClientChannel | null = null
  private sftpChannel: Promise<SFTPWrapper | null> | null = null

  /** Set while swallowing the echo of an injected setup command. */
  private suppress: { marker: string; buffer: string; timer: NodeJS.Timeout } | null = null

  private constructor() {
    super()
  }

  /** Funnel for shell output, so injected commands can be hidden from the user. */
  private pushData(chunk: string): void {
    if (!this.suppress) {
      this.emit('data', chunk)
      return
    }

    this.suppress.buffer += chunk
    const index = this.suppress.buffer.indexOf(this.suppress.marker)

    if (index === -1) {
      // Never let a shell that won't cooperate hold output hostage.
      if (this.suppress.buffer.length > 32_000) this.endSuppression(true)
      return
    }

    const rest = this.suppress.buffer
      .slice(index + this.suppress.marker.length)
      .replace(/^\r?\n/, '')
    clearTimeout(this.suppress.timer)
    this.suppress = null
    if (rest) this.emit('data', rest)
  }

  private endSuppression(flush: boolean): void {
    if (!this.suppress) return
    const { buffer, timer } = this.suppress
    clearTimeout(timer)
    this.suppress = null
    if (flush && buffer) this.emit('data', buffer)
  }

  static async connect(
    session: SavedSession,
    cols: number,
    rows: number,
    prompter: SshPrompter,
    /** Resolves a stored secret by vault id, or null to prompt interactively. */
    lookupSecret: (vaultId: string) => Promise<string | null>,
    /** SFTP-only sessions open no shell channel. */
    options: { shell?: boolean } = {}
  ): Promise<SshTerminal> {
    const term = new SshTerminal()
    const client = await connectSshClient(session, prompter, lookupSecret)
    term.client = client

    client.on('error', (err) => term.emit('error', err))
    client.on('close', () => term.emit('exit', { code: 0 }))

    if (options.shell === false) {
      term.emit('data', '\x1b[2mSFTP session — use the file browser on the left.\x1b[0m\r\n')
      return term
    }

    term.stream = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) reject(err)
        else resolve(stream)
      })
    })

    term.stream.on('data', (chunk: Buffer) => term.pushData(chunk.toString('utf8')))
    term.stream.stderr.on('data', (chunk: Buffer) => term.pushData(chunk.toString('utf8')))
    term.stream.on('close', () => {
      term.endSuppression(true)
      term.emit('exit', { code: 0 })
    })

    if (session.trackCwd) {
      const marker = `MCRDY${randomBytes(5).toString('hex')}`
      term.suppress = {
        marker,
        buffer: '',
        timer: setTimeout(() => term.endSuppression(true), 6000)
      }
      term.stream.write(`${osc7Hook(marker)}\n`)
    }

    for (const command of session.initCommands ?? []) term.stream.write(`${command}\n`)

    return term
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  /** The live connection, for callers that need their own channel (stats polling). */
  get connection(): Client | null {
    return this.client
  }

  /** Opens a second channel on the same connection — no re-auth, no extra login. */
  sftp(): Promise<SFTPWrapper | null> {
    if (!this.sftpChannel) {
      this.sftpChannel = new Promise<SFTPWrapper | null>((resolve) => {
        if (!this.client) return resolve(null)
        this.client.sftp((err, sftp) => resolve(err ? null : sftp))
      })
    }
    return this.sftpChannel
  }

  dispose(): void {
    try {
      this.stream?.end()
      this.client?.end()
    } catch {
      /* connection already torn down */
    }
    this.stream = null
    this.client = null
    this.sftpChannel = null
  }
}

/** parseKey can hand back a single key, a list, or an Error — normalise all three. */
function parsedKeyType(key: Buffer): string {
  const parsed = utils.parseKey(key)
  if (parsed instanceof Error) return 'ssh-unknown'
  return Array.isArray(parsed) ? (parsed[0]?.type ?? 'ssh-unknown') : parsed.type
}

/**
 * Authenticate and open an SSH connection. Shared by terminal tabs and by the
 * tunnel manager, which needs its own connection independent of any tab.
 */
export async function connectSshClient(
  session: SavedSession,
  prompter: SshPrompter,
  lookupSecret: (vaultId: string) => Promise<string | null>
): Promise<Client> {
  const client = new Client()
  const config = await buildConnectConfig(session, prompter, lookupSecret)

  const host = session.host!
  const port = session.port ?? 22

  config.hostVerifier = (key: Buffer, callback: (ok: boolean) => void) => {
    const keyType = parsedKeyType(key)
    const verdict = verifyHostKey(host, port, keyType, key)

    if (verdict.status === 'trusted') return callback(true)

    void prompter
      .confirmHostKey({
        host,
        port,
        keyType,
        fingerprint: fingerprintOf(key),
        mismatch: verdict.status === 'mismatch'
      })
      .then((accepted) => {
        // Never persist a key that conflicts with a stored one; trust it for
        // this connection only if the user insisted.
        if (accepted && verdict.status === 'unknown') trustHostKey(host, port, keyType, key)
        callback(accepted)
      })
      .catch(() => callback(false))
  }

  client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    // ssh2 leaves `echo` optional; default to hidden, which is the safe reading.
    const normalised = prompts.map((p) => ({ prompt: p.prompt, echo: p.echo ?? false }))
    void prompter
      .askSecret('keyboard-interactive', `${session.username}@${host}`, normalised)
      .then((answers) => finish(answers ?? []))
  })

  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve)
    client.once('error', reject)
    client.connect(config)
  })

  return client
}

function fingerprintOf(key: Buffer): string {
  const hash = createHash('sha256').update(key).digest('base64')
  return `SHA256:${hash.replace(/=+$/, '')}`
}

async function buildConnectConfig(
  session: SavedSession,
  prompter: SshPrompter,
  lookupSecret: (vaultId: string) => Promise<string | null>
): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: session.host,
    port: session.port ?? 22,
    username: session.username,
    tryKeyboard: true,
    keepaliveInterval: 20_000,
    readyTimeout: 30_000
  }

  const label = `${session.username}@${session.host}`

  switch (session.authMethod ?? 'agent') {
    case 'agent': {
      const sock = process.env.SSH_AUTH_SOCK
      if (!sock) throw new Error('No SSH agent found (SSH_AUTH_SOCK is unset)')
      config.agent = sock
      break
    }

    case 'key': {
      // An imported key lives in the app's store; otherwise fall back to a path
      // the user pointed at directly.
      const imported = session.keyId ? getKey(session.keyId) : undefined
      const path = imported
        ? keyFilePath(imported.id)
        : session.privateKeyPath || join(homedir(), '.ssh', 'id_ed25519')
      const vaultId = imported ? keyVaultId(imported.id) : session.id

      const keyData = readFileSync(path)
      const parsed = utils.parseKey(keyData)

      if (parsed instanceof Error) {
        // Almost always means the key is passphrase-protected.
        const stored = await lookupSecret(vaultId)
        const passphrase =
          stored ??
          (
            await prompter.askSecret('passphrase', label, [
              {
                prompt: `Passphrase for ${imported ? imported.name : path}:`,
                echo: false
              }
            ])
          )?.[0]
        if (!passphrase) throw new Error('Passphrase required to unlock private key')
        config.passphrase = passphrase
      }

      config.privateKey = keyData
      break
    }

    case 'password': {
      const stored = await lookupSecret(session.id)
      const password =
        stored ??
        (await prompter.askSecret('password', label, [{ prompt: 'Password:', echo: false }]))?.[0]
      if (!password) throw new Error('Password required')
      config.password = password
      break
    }
  }

  return config
}
