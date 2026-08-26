import type { Socket } from 'node:net'

/**
 * Minimal SOCKS5 server-side handshake (RFC 1928), enough for `ssh -D`-style
 * dynamic forwarding: no authentication, CONNECT command only.
 *
 * Resolves with the destination the client asked for; the caller opens the
 * real channel and must then call `succeed` or `fail`.
 */
export interface Socks5Request {
  host: string
  port: number
  succeed: () => void
  fail: (reply?: number) => void
}

const VERSION = 0x05
const CMD_CONNECT = 0x01
const ATYP_IPV4 = 0x01
const ATYP_DOMAIN = 0x03
const ATYP_IPV6 = 0x04

export const SOCKS_REPLY = {
  SUCCESS: 0x00,
  GENERAL_FAILURE: 0x01,
  HOST_UNREACHABLE: 0x04,
  COMMAND_NOT_SUPPORTED: 0x07,
  ADDRESS_TYPE_NOT_SUPPORTED: 0x08
}

/** A fixed 0.0.0.0:0 BND.ADDR — clients accept it and we have nothing truer to report. */
function reply(code: number): Buffer {
  return Buffer.from([VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
}

export function handleSocks5(socket: Socket): Promise<Socks5Request> {
  return new Promise((resolve, reject) => {
    let stage: 'greeting' | 'request' | 'done' = 'greeting'
    let buffer = Buffer.alloc(0)

    const fail = (message: string, code = SOCKS_REPLY.GENERAL_FAILURE) => {
      stage = 'done'
      socket.removeListener('data', onData)
      try {
        socket.end(reply(code))
      } catch {
        /* peer already gone */
      }
      reject(new Error(message))
    }

    function onData(chunk: Buffer) {
      if (stage === 'done') return
      buffer = Buffer.concat([buffer, chunk])

      if (stage === 'greeting') {
        if (buffer.length < 2) return
        if (buffer[0] !== VERSION) return fail('not a SOCKS5 client')
        const methodCount = buffer[1]
        if (buffer.length < 2 + methodCount) return
        buffer = buffer.subarray(2 + methodCount)
        stage = 'request'
        // 0x00 = no authentication required.
        socket.write(Buffer.from([VERSION, 0x00]))
      }

      if (stage === 'request') {
        if (buffer.length < 4) return
        if (buffer[0] !== VERSION) return fail('bad SOCKS5 request')
        if (buffer[1] !== CMD_CONNECT) {
          return fail('only CONNECT is supported', SOCKS_REPLY.COMMAND_NOT_SUPPORTED)
        }

        const atyp = buffer[3]
        let host: string
        let offset: number

        if (atyp === ATYP_IPV4) {
          if (buffer.length < 10) return
          host = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`
          offset = 8
        } else if (atyp === ATYP_DOMAIN) {
          const length = buffer[4]
          if (buffer.length < 5 + length + 2) return
          host = buffer.subarray(5, 5 + length).toString('utf8')
          offset = 5 + length
        } else if (atyp === ATYP_IPV6) {
          if (buffer.length < 22) return
          const groups: string[] = []
          for (let i = 0; i < 16; i += 2) groups.push(buffer.readUInt16BE(4 + i).toString(16))
          host = groups.join(':')
          offset = 20
        } else {
          return fail('unsupported address type', SOCKS_REPLY.ADDRESS_TYPE_NOT_SUPPORTED)
        }

        const port = buffer.readUInt16BE(offset)
        stage = 'done'
        socket.removeListener('data', onData)

        resolve({
          host,
          port,
          succeed: () => socket.write(reply(SOCKS_REPLY.SUCCESS)),
          fail: (code = SOCKS_REPLY.HOST_UNREACHABLE) => socket.end(reply(code))
        })
      }
    }

    socket.on('data', onData)
    socket.once('error', (err) => {
      stage = 'done'
      reject(err)
    })
  })
}
