import { EventEmitter } from 'node:events'
import { SerialPort } from 'serialport'
import type { SavedSession } from '@shared/types'
import type { TerminalBackend } from './backend'

/** A serial console. Common baud rates are offered in the session dialog. */
export class SerialTerminal extends EventEmitter implements TerminalBackend {
  private port: SerialPort | null = null

  constructor(session: SavedSession) {
    super()

    const path = session.serialPath
    if (!path) throw new Error('No serial device selected')

    const baudRate = session.baudRate ?? 115200
    this.port = new SerialPort({ path, baudRate, autoOpen: false })

    this.port.open((err) => {
      if (err) {
        this.emit('error', err)
        this.emit('exit', { code: 1 })
        return
      }
      this.emit('data', `\x1b[2mOpened ${path} at ${baudRate} baud\x1b[0m\r\n`)
    })

    this.port.on('data', (chunk: Buffer) => this.emit('data', chunk.toString('utf8')))
    this.port.on('error', (err) => this.emit('error', err))
    this.port.on('close', () => {
      this.port = null
      this.emit('exit', { code: 0 })
    })
  }

  write(data: string): void {
    this.port?.write(data)
  }

  /** Serial has no window-size concept. */
  resize(): void {}

  async sftp(): Promise<null> {
    return null
  }

  dispose(): void {
    try {
      this.port?.close(() => {})
    } catch {
      /* already closed */
    }
    this.port = null
  }
}

/** Devices currently present, for the session dialog's picker. */
export async function listSerialPorts(): Promise<{ path: string; label: string }[]> {
  const ports = await SerialPort.list()
  return ports.map((port) => ({
    path: port.path,
    label: [port.manufacturer, port.productId ? `(${port.productId})` : null]
      .filter(Boolean)
      .join(' ')
  }))
}
