import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import type { SavedSession } from '@shared/types'
import type { TerminalBackend } from './backend'

// Telnet command bytes (RFC 854 / RFC 1073).
const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240
const OPT_ECHO = 1
const OPT_SGA = 3
const OPT_TTYPE = 24
const OPT_NAWS = 31

/**
 * Telnet over a raw socket. Servers negotiate options before anything useful
 * appears, so this answers the handshake rather than letting IAC bytes leak
 * into the terminal as mojibake.
 */
export class TelnetTerminal extends EventEmitter implements TerminalBackend {
  private socket: Socket | null
  private pending = Buffer.alloc(0)
  private cols: number
  private rows: number

  constructor(session: SavedSession, cols: number, rows: number) {
    super()
    this.cols = cols
    this.rows = rows

    const socket = connect(session.port ?? 23, session.host!)
    this.socket = socket

    socket.on('connect', () => this.emit('data', `\x1b[2mConnected to ${session.host}\x1b[0m\r\n`))
    socket.on('data', (chunk) => this.consume(chunk))
    socket.on('error', (err) => this.emit('error', err))
    socket.on('close', () => {
      this.socket = null
      this.emit('exit', { code: 0 })
    })
  }

  /** Split the stream into telnet commands (answered) and payload (displayed). */
  private consume(chunk: Buffer): void {
    const data = Buffer.concat([this.pending, chunk])
    const out: number[] = []
    let i = 0

    while (i < data.length) {
      if (data[i] !== IAC) {
        out.push(data[i++])
        continue
      }

      // A trailing partial command waits for the rest of the stream.
      if (i + 1 >= data.length) break
      const command = data[i + 1]

      if (command === IAC) {
        out.push(IAC) // escaped 0xFF literal
        i += 2
        continue
      }

      if (command === WILL || command === WONT || command === DO || command === DONT) {
        if (i + 2 >= data.length) break
        this.negotiate(command, data[i + 2])
        i += 3
        continue
      }

      if (command === SB) {
        const end = data.indexOf(SE, i + 2)
        if (end === -1) break
        this.subnegotiate(data.subarray(i + 2, end))
        i = end + 1
        continue
      }

      i += 2 // any other two-byte command we don't act on
    }

    this.pending = data.subarray(i)
    if (out.length) this.emit('data', Buffer.from(out).toString('utf8'))
  }

  private negotiate(command: number, option: number): void {
    if (!this.socket) return

    if (command === DO || command === DONT) {
      // We only volunteer terminal type and window size.
      const willing = option === OPT_TTYPE || option === OPT_NAWS
      this.socket.write(Buffer.from([IAC, willing && command === DO ? WILL : WONT, option]))
      if (willing && command === DO && option === OPT_NAWS) this.sendWindowSize()
      return
    }

    // Let the server echo and suppress go-ahead; refuse anything else.
    const acceptable = option === OPT_ECHO || option === OPT_SGA
    this.socket.write(Buffer.from([IAC, acceptable && command === WILL ? DO : DONT, option]))
  }

  private subnegotiate(payload: Buffer): void {
    // Terminal-type request: SEND(1) -> reply IS(0) "xterm-256color".
    if (payload[0] === OPT_TTYPE && payload[1] === 1 && this.socket) {
      this.socket.write(
        Buffer.concat([
          Buffer.from([IAC, SB, OPT_TTYPE, 0]),
          Buffer.from('xterm-256color', 'ascii'),
          Buffer.from([IAC, SE])
        ])
      )
    }
  }

  private sendWindowSize(): void {
    if (!this.socket) return
    const size = Buffer.alloc(4)
    size.writeUInt16BE(this.cols, 0)
    size.writeUInt16BE(this.rows, 2)
    this.socket.write(
      Buffer.concat([Buffer.from([IAC, SB, OPT_NAWS]), size, Buffer.from([IAC, SE])])
    )
  }

  write(data: string): void {
    // A literal 0xFF in user input has to be doubled so it isn't read as IAC.
    const raw = Buffer.from(data, 'utf8')
    const escaped: number[] = []
    for (const byte of raw) {
      escaped.push(byte)
      if (byte === IAC) escaped.push(IAC)
    }
    this.socket?.write(Buffer.from(escaped))
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.sendWindowSize()
  }

  async sftp(): Promise<null> {
    return null
  }

  dispose(): void {
    try {
      this.socket?.destroy()
    } catch {
      /* already closed */
    }
    this.socket = null
  }
}
