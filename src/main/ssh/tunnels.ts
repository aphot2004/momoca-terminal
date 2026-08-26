import { randomUUID } from 'node:crypto'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import type { Client } from 'ssh2'
import type { Tunnel, TunnelStatus } from '@shared/types'
import { createPrompter } from '../prompts'
import { JsonFile } from '../store/json-file'
import { revealSecret } from '../store/secrets'
import { getSession } from '../store/sessions'
import { handleSocks5, SOCKS_REPLY } from './socks5'
import { connectSshClient } from './ssh-terminal'

interface TunnelFile {
  version: 1
  tunnels: Tunnel[]
}

const file = new JsonFile<TunnelFile>(join(app.getPath('userData'), 'tunnels.json'), () => ({
  version: 1,
  tunnels: []
}))

interface Live {
  client: Client
  server: Server | null
  status: TunnelStatus
}

const live = new Map<string, Live>()

// --- persistence -----------------------------------------------------------

export function listTunnels(): Tunnel[] {
  return file.read().tunnels
}

export function saveTunnel(input: Tunnel | Omit<Tunnel, 'id'>): Tunnel {
  const id = 'id' in input && input.id ? input.id : randomUUID()
  const tunnel: Tunnel = { ...input, id }
  file.update((current) => ({
    ...current,
    tunnels: [...current.tunnels.filter((t) => t.id !== id), tunnel]
  }))
  return tunnel
}

export function deleteTunnel(id: string): void {
  stopTunnel(id)
  file.update((current) => ({ ...current, tunnels: current.tunnels.filter((t) => t.id !== id) }))
}

export function statuses(): TunnelStatus[] {
  return listTunnels().map(
    (t) => live.get(t.id)?.status ?? { id: t.id, state: 'stopped', connections: 0 }
  )
}

// --- lifecycle -------------------------------------------------------------

function notify(sender: WebContents): void {
  if (!sender.isDestroyed()) sender.send('tunnels:status', statuses())
}

export async function startTunnel(id: string, sender: WebContents): Promise<void> {
  if (live.has(id)) return

  const tunnel = listTunnels().find((t) => t.id === id)
  if (!tunnel) throw new Error('Unknown tunnel')

  const session = getSession(tunnel.sessionId)
  if (!session) throw new Error('Tunnel has no saved SSH session')

  const status: TunnelStatus = { id, state: 'starting', connections: 0 }
  // Registered before connecting so a second start can't race in.
  live.set(id, { client: null as unknown as Client, server: null, status })
  notify(sender)

  const fail = (err: unknown) => {
    status.state = 'error'
    status.error = err instanceof Error ? err.message : String(err)
    notify(sender)
  }

  try {
    const client = await connectSshClient(
      session,
      createPrompter(sender, `tunnel:${id}`),
      (vaultId) => revealSecret(vaultId)
    )

    const entry = live.get(id)
    if (!entry) {
      client.end() // stopped while we were connecting
      return
    }
    entry.client = client

    client.on('error', (err) => fail(err))
    client.on('close', () => {
      if (status.state === 'running') {
        status.state = 'error'
        status.error = 'SSH connection closed'
        notify(sender)
      }
      cleanup(id)
    })

    if (tunnel.type === 'remote') {
      await startRemote(tunnel, client, status, sender)
    } else {
      entry.server = await startLocalListener(tunnel, client, status, sender)
    }

    status.state = 'running'
    status.error = undefined
    notify(sender)
  } catch (err) {
    fail(err)
    cleanup(id)
  }
}

/** Local (-L) and dynamic (-D) both listen here; only the destination differs. */
function startLocalListener(
  tunnel: Tunnel,
  client: Client,
  status: TunnelStatus,
  sender: WebContents
): Promise<Server> {
  const server = createServer((socket: Socket) => {
    socket.on('error', () => socket.destroy())

    const bridge = (host: string, port: number, onReady?: () => void, onFail?: () => void) => {
      client.forwardOut(
        socket.remoteAddress ?? '127.0.0.1',
        socket.remotePort ?? 0,
        host,
        port,
        (err, stream) => {
          if (err) {
            onFail?.()
            socket.destroy()
            return
          }
          onReady?.()
          status.connections++
          notify(sender)
          socket.pipe(stream).pipe(socket)
          stream.on('close', () => socket.destroy())
        }
      )
    }

    if (tunnel.type === 'dynamic') {
      void handleSocks5(socket)
        .then(({ host, port, succeed, fail }) =>
          bridge(host, port, succeed, () => fail(SOCKS_REPLY.HOST_UNREACHABLE))
        )
        .catch(() => socket.destroy())
    } else {
      bridge(tunnel.destHost!, tunnel.destPort!)
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(tunnel.listenPort, tunnel.listenHost || '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })
}

/** Remote (-R): the server listens, and each connection comes back to us. */
function startRemote(
  tunnel: Tunnel,
  client: Client,
  status: TunnelStatus,
  sender: WebContents
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.forwardIn(tunnel.listenHost || '127.0.0.1', tunnel.listenPort, (err) => {
      if (err) return reject(err)
      resolve()
    })

    client.on('tcp connection', (info, accept) => {
      if (info.destPort !== tunnel.listenPort) return
      const stream = accept()
      status.connections++
      notify(sender)

      const socket = connect(tunnel.destPort!, tunnel.destHost!, () => {
        stream.pipe(socket).pipe(stream)
      })
      socket.on('error', () => stream.end())
      stream.on('close', () => socket.destroy())
    })
  })
}

function cleanup(id: string): void {
  const entry = live.get(id)
  if (!entry) return
  try {
    entry.server?.close()
  } catch {
    /* already closed */
  }
  try {
    entry.client?.end()
  } catch {
    /* already closed */
  }
  live.delete(id)
}

export function stopTunnel(id: string): void {
  cleanup(id)
}

export function stopAllTunnels(): void {
  for (const id of [...live.keys()]) cleanup(id)
}
