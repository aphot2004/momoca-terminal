import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { reverse } from 'node:dns/promises'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import type { DiscoveredHost, PingSample, PortResult, ScanTarget } from '@shared/types'

const run = promisify(execFile)

/**
 * Ceilings so a mistyped range can't spawn an unbounded scan. A /16 sweep would
 * be 65k probes; refusing is friendlier than appearing to hang.
 */
const MAX_PORTS = 4096
const MAX_HOSTS = 1024
const DEFAULT_CONCURRENCY = 128

/** Cancellable jobs, keyed by the id handed back to the renderer. */
const jobs = new Map<string, { cancelled: boolean }>()

export function cancelJob(jobId: string): void {
  const job = jobs.get(jobId)
  if (job) job.cancelled = true
}

function startJob(): { jobId: string; job: { cancelled: boolean } } {
  const jobId = randomUUID()
  const job = { cancelled: false }
  jobs.set(jobId, job)
  return { jobId, job }
}

function endJob(jobId: string): void {
  jobs.delete(jobId)
}

/** Run `tasks` with bounded concurrency, stopping early if the job is cancelled. */
async function pool<T>(
  items: T[],
  limit: number,
  job: { cancelled: boolean },
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!job.cancelled) {
      const i = index++
      if (i >= items.length) return
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

// --- ports -----------------------------------------------------------------

/** Expand "22,80,8000-8010" into a bounded, de-duplicated port list. */
export function parsePorts(spec: string): number[] {
  const ports = new Set<number>()

  for (const part of spec.split(',')) {
    const chunk = part.trim()
    if (!chunk) continue

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(chunk)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to > 65535 || to < from) throw new Error(`Invalid port range "${chunk}"`)
      for (let p = from; p <= to; p++) {
        ports.add(p)
        if (ports.size > MAX_PORTS) throw new Error(`Too many ports — cap is ${MAX_PORTS}`)
      }
      continue
    }

    const single = Number(chunk)
    if (!Number.isInteger(single) || single < 1 || single > 65535) {
      throw new Error(`Invalid port "${chunk}"`)
    }
    ports.add(single)
  }

  if (!ports.size) throw new Error('No ports specified')
  return [...ports].sort((a, b) => a - b)
}

/** Well-known services, so results read as more than bare numbers. */
const SERVICES: Record<number, string> = {
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 67: 'dhcp',
  80: 'http', 110: 'pop3', 111: 'rpcbind', 123: 'ntp', 135: 'msrpc', 139: 'netbios',
  143: 'imap', 161: 'snmp', 389: 'ldap', 443: 'https', 445: 'smb', 465: 'smtps',
  514: 'syslog', 587: 'submission', 631: 'ipp', 636: 'ldaps', 873: 'rsync',
  993: 'imaps', 995: 'pop3s', 1080: 'socks', 1433: 'mssql', 1521: 'oracle',
  1883: 'mqtt', 2049: 'nfs', 2222: 'ssh-alt', 3000: 'dev-http', 3128: 'squid',
  3306: 'mysql', 3389: 'rdp', 5000: 'upnp', 5432: 'postgres', 5601: 'kibana',
  5672: 'amqp', 5900: 'vnc', 5984: 'couchdb', 6379: 'redis', 8000: 'http-alt',
  8080: 'http-proxy', 8086: 'influxdb', 8443: 'https-alt', 9000: 'http-alt',
  9090: 'prometheus', 9200: 'elasticsearch', 11211: 'memcached', 27017: 'mongodb'
}

export const COMMON_PORTS = Object.keys(SERVICES).map(Number).sort((a, b) => a - b)

/** One TCP connect attempt. Refused is a useful answer: the host is up. */
function probePort(host: string, port: number, timeoutMs: number): Promise<PortResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = connect({ host, port })
    let settled = false

    const finish = (state: PortResult['state']) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ port, state, service: SERVICES[port], ms: Date.now() - started })
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish('open'))
    socket.once('timeout', () => finish('filtered'))
    socket.once('error', (err: NodeJS.ErrnoException) =>
      finish(err.code === 'ECONNREFUSED' ? 'closed' : 'filtered')
    )
  })
}

export async function scanPorts(
  target: ScanTarget,
  sender: WebContents
): Promise<{ jobId: string }> {
  const ports = parsePorts(target.ports)
  const { jobId, job } = startJob()
  const timeout = Math.min(Math.max(target.timeoutMs ?? 700, 100), 10_000)

  void (async () => {
    let done = 0
    const open: PortResult[] = []

    await pool(ports, target.concurrency ?? DEFAULT_CONCURRENCY, job, async (port) => {
      const result = await probePort(target.host, port, timeout)
      done++
      if (result.state === 'open') open.push(result)

      if (!sender.isDestroyed()) {
        sender.send('net:scan', {
          jobId,
          done,
          total: ports.length,
          // Only open ports are streamed; closed ones would drown the list.
          result: result.state === 'open' ? result : undefined
        })
      }
    })

    if (!sender.isDestroyed()) {
      sender.send('net:scan', {
        jobId,
        done,
        total: ports.length,
        finished: true,
        cancelled: job.cancelled,
        open: open.sort((a, b) => a.port - b.port)
      })
    }
    endJob(jobId)
  })()

  return { jobId }
}

// --- ping ------------------------------------------------------------------

/**
 * Shell out to /sbin/ping rather than opening a raw socket, which needs root.
 * Output is streamed line by line so the UI fills in as replies arrive.
 */
export function pingHost(
  host: string,
  count: number,
  sender: WebContents
): { jobId: string } {
  const { jobId, job } = startJob()
  const total = Math.min(Math.max(count, 1), 100)

  // -n skips reverse DNS per reply; -W bounds the wait for a straggler.
  const child = spawn('/sbin/ping', ['-c', String(total), '-n', '-W', '1500', host])
  const samples: PingSample[] = []
  let buffer = ''

  const emit = (payload: object) => {
    if (!sender.isDestroyed()) sender.send('net:ping', { jobId, ...payload })
  }

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const reply = /icmp_seq=(\d+).*?ttl=(\d+).*?time=([\d.]+) ms/.exec(line)
      if (reply) {
        const sample: PingSample = {
          seq: Number(reply[1]),
          ttl: Number(reply[2]),
          ms: Number(reply[3])
        }
        samples.push(sample)
        emit({ sample, total })
        continue
      }
      if (/Request timeout|100% packet loss|host unreachable/i.test(line)) {
        emit({ sample: { seq: samples.length, ttl: 0, ms: null }, total })
      }
    }
  })

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))

  child.on('close', () => {
    const times = samples.map((s) => s.ms).filter((m): m is number => m !== null)
    emit({
      finished: true,
      cancelled: job.cancelled,
      error: times.length === 0 ? stderr.trim() || 'No replies' : undefined,
      summary: {
        sent: total,
        received: times.length,
        loss: total ? (total - times.length) / total : 0,
        min: times.length ? Math.min(...times) : null,
        avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        max: times.length ? Math.max(...times) : null
      }
    })
    endJob(jobId)
  })

  child.on('error', (err) => {
    emit({ finished: true, error: err.message })
    endJob(jobId)
  })

  // Killing the child is what "cancel" means for a ping.
  const watch = setInterval(() => {
    if (job.cancelled || child.killed) {
      clearInterval(watch)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
  }, 250)
  child.on('close', () => clearInterval(watch))

  return { jobId }
}

// --- discovery ---------------------------------------------------------------

/** IPv4 networks this Mac is on, as CIDR, for the discovery default. */
export function localNetworks(): { cidr: string; address: string; iface: string }[] {
  const found: { cidr: string; address: string; iface: string }[] = []

  for (const [iface, addresses] of Object.entries(networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      const bits = maskToBits(addr.netmask)
      if (bits < 20) continue // anything wider than /20 is impractical to sweep
      found.push({ cidr: `${networkAddress(addr.address, bits)}/${bits}`, address: addr.address, iface })
    }
  }
  return found
}

function maskToBits(netmask: string): number {
  return netmask
    .split('.')
    .map((o) => (Number(o) >>> 0).toString(2).replace(/0/g, '').length)
    .reduce((a, b) => a + b, 0)
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

function networkAddress(ip: string, bits: number): string {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return intToIp((ipToInt(ip) & mask) >>> 0)
}

/** Every usable host address in a CIDR, excluding network and broadcast. */
export function expandCidr(cidr: string): string[] {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim())
  if (!match) throw new Error(`"${cidr}" is not a valid IPv4 CIDR, e.g. 192.168.1.0/24`)

  const bits = Number(match[2])
  if (bits < 8 || bits > 32) throw new Error('Prefix must be between /8 and /32')

  const size = bits === 32 ? 1 : 2 ** (32 - bits)
  if (size - 2 > MAX_HOSTS) {
    throw new Error(`${cidr} covers ${size} addresses — cap is ${MAX_HOSTS}. Try a /24.`)
  }

  const base = ipToInt(networkAddress(match[1], bits))
  if (bits >= 31) return [intToIp(base)]

  const hosts: string[] = []
  for (let i = 1; i < size - 1; i++) hosts.push(intToIp(base + i))
  return hosts
}

/** MAC addresses the kernel already knows, to annotate discovered hosts. */
async function arpTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>()
  try {
    const { stdout } = await run('/usr/sbin/arp', ['-an'])
    for (const line of stdout.split('\n')) {
      const m = /\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]{11,17})/i.exec(line)
      if (m && !/incomplete/i.test(line)) table.set(m[1], m[2])
    }
  } catch {
    /* arp is best-effort decoration */
  }
  return table
}

/**
 * Sweep a subnet. A single ping with a short deadline decides liveness; hosts
 * that ignore ICMP are then given a chance to answer on a few common TCP ports,
 * which catches firewalled machines a naive ping sweep would call dead.
 */
export async function discover(
  cidr: string,
  sender: WebContents,
  probePorts: number[] = [22, 80, 443, 445, 3389, 5900]
): Promise<{ jobId: string }> {
  const hosts = expandCidr(cidr)
  const { jobId, job } = startJob()

  void (async () => {
    let done = 0
    const alive: DiscoveredHost[] = []
    const arp = await arpTable()

    await pool(hosts, 64, job, async (ip) => {
      let via: DiscoveredHost['via'] | null = null
      let ms: number | null = null

      const started = Date.now()
      const pinged = await new Promise<boolean>((resolve) => {
        const child = spawn('/sbin/ping', ['-c', '1', '-n', '-W', '600', '-t', '1', ip])
        child.on('close', (code) => resolve(code === 0))
        child.on('error', () => resolve(false))
      })

      if (pinged) {
        via = 'icmp'
        ms = Date.now() - started
      } else if (!job.cancelled) {
        for (const port of probePorts) {
          const result = await probePort(ip, port, 300)
          if (result.state === 'open') {
            via = 'tcp'
            ms = result.ms
            break
          }
        }
      }

      done++

      if (via) {
        // Reverse DNS only for hosts that answered, and never let a slow
        // resolver stall the sweep.
        const hostname = await Promise.race([
          reverse(ip).then((names) => names[0]),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 800))
        ]).catch(() => undefined)

        const host: DiscoveredHost = { ip, via, ms, hostname, mac: arp.get(ip) }
        alive.push(host)
        if (!sender.isDestroyed()) {
          sender.send('net:discover', { jobId, done, total: hosts.length, host })
        }
      } else if (!sender.isDestroyed()) {
        sender.send('net:discover', { jobId, done, total: hosts.length })
      }
    })

    if (!sender.isDestroyed()) {
      sender.send('net:discover', {
        jobId,
        done,
        total: hosts.length,
        finished: true,
        cancelled: job.cancelled,
        hosts: alive.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip))
      })
    }
    endJob(jobId)
  })()

  return { jobId }
}
