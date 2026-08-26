import type { WebContents } from 'electron'
import type { Client } from 'ssh2'
import type { RemoteStats } from '@shared/types'

/**
 * One shot that gathers everything we need from the server. Markers keep the
 * parsing robust when a command is missing; `2>/dev/null` plus the guards mean
 * a BSD/macOS host simply omits the /proc sections rather than erroring.
 */
const PROBE = [
  'echo "#OS"; uname -s',
  'echo "#CPUS"; (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)',
  'echo "#STAT"; head -1 /proc/stat 2>/dev/null',
  'echo "#MEM"; head -5 /proc/meminfo 2>/dev/null',
  'echo "#VMSTAT"; (vm_stat 2>/dev/null | head -8)',
  'echo "#HWMEM"; sysctl -n hw.memsize 2>/dev/null',
  'echo "#DF"; df -kP / 2>/dev/null | tail -1',
  'echo "#LOAD"; (cat /proc/loadavg 2>/dev/null || uptime)',
  'echo "#UP"; (cut -d. -f1 /proc/uptime 2>/dev/null || sysctl -n kern.boottime 2>/dev/null)',
  'echo "#NET"; (tail -n +3 /proc/net/dev 2>/dev/null || netstat -ibn 2>/dev/null)',
  'echo "#END"'
].join('; ')

interface Sample {
  idle: number
  total: number
}

interface NetSample {
  rx: number
  tx: number
  at: number
}

function section(output: string, name: string): string {
  const start = output.indexOf(`#${name}\n`)
  if (start === -1) return ''
  const from = start + name.length + 2
  const next = output.indexOf('\n#', from - 1)
  return output.slice(from, next === -1 ? undefined : next).trim()
}

/** Linux: /proc/stat aggregate line. */
function parseCpuSample(stat: string): Sample | null {
  if (!stat.startsWith('cpu ')) return null
  const values = stat.split(/\s+/).slice(1).map(Number).filter((n) => !Number.isNaN(n))
  if (values.length < 4) return null
  const total = values.reduce((a, b) => a + b, 0)
  // idle + iowait
  const idle = (values[3] ?? 0) + (values[4] ?? 0)
  return { idle, total }
}

function parseMemory(output: string): { used: number; total: number } {
  const meminfo = section(output, 'MEM')
  if (meminfo.includes('MemTotal')) {
    const kb = (label: string) =>
      Number(new RegExp(`${label}:\\s+(\\d+)`).exec(meminfo)?.[1] ?? 0) * 1024
    const total = kb('MemTotal')
    const available = kb('MemAvailable')
    if (total && available) return { used: total - available, total }
    // Older kernels without MemAvailable.
    const free = kb('MemFree') + kb('Buffers') + kb('Cached')
    return { used: Math.max(0, total - free), total }
  }

  // macOS remote: derive from vm_stat page counts.
  const vmstat = section(output, 'VMSTAT')
  const total = Number(section(output, 'HWMEM')) || 0
  if (vmstat && total) {
    const pageSize = Number(/page size of (\d+) bytes/.exec(vmstat)?.[1] ?? 4096)
    const pages = (label: string) =>
      Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vmstat)?.[1] ?? 0)
    const used = (pages('Pages active') + pages('Pages wired down')) * pageSize
    return { used: Math.min(used, total), total }
  }

  return { used: 0, total: 0 }
}

function parseNetwork(output: string): { rx: number; tx: number } {
  const net = section(output, 'NET')
  let rx = 0
  let tx = 0

  if (net.includes(':')) {
    // Linux /proc/net/dev — "iface: rx_bytes ... tx_bytes ..."
    for (const line of net.split('\n')) {
      const [name, rest] = line.split(':')
      if (!rest || name.trim() === 'lo') continue
      const cols = rest.trim().split(/\s+/).map(Number)
      rx += cols[0] || 0
      tx += cols[8] || 0
    }
    return { rx, tx }
  }

  // BSD netstat -ibn
  const seen = new Set<string>()
  for (const line of net.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 10 || cols[0] === 'lo0' || seen.has(cols[0])) continue
    seen.add(cols[0])
    rx += Number(cols[6]) || 0
    tx += Number(cols[9]) || 0
  }
  return { rx, tx }
}

function parseLoad(output: string): [number, number, number] {
  const load = section(output, 'LOAD')
  // /proc/loadavg starts with the three numbers; `uptime` has them after "average:".
  const after = load.includes('average') ? load.split('average')[1].replace(/^[:s]+/, '') : load
  const nums = after
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0]
}

/**
 * Polls a connected SSH server for host metrics. One `exec` per tick, ~3s
 * apart — cheap enough to leave running, and the CPU figure needs two samples
 * anyway so the first tick reports 0.
 */
export class RemoteStatsPoller {
  private timer: NodeJS.Timeout | null = null
  private lastCpu: Sample | null = null
  private lastNet: NetSample | null = null
  private stopped = false

  constructor(
    private readonly client: Client,
    private readonly tabId: string,
    private readonly sender: WebContents,
    private readonly label: string,
    private readonly intervalMs = 3000
  ) {}

  start(): void {
    this.tick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.stopped || this.sender.isDestroyed()) return
    this.timer = setTimeout(() => this.tick(), this.intervalMs)
  }

  private tick(): void {
    if (this.stopped || this.sender.isDestroyed()) return

    this.client.exec(PROBE, (err, stream) => {
      if (err) return this.schedule()

      let output = ''
      stream.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
      stream.stderr.on('data', () => {})
      stream.on('close', () => {
        try {
          const stats = this.parse(output)
          if (stats && !this.sender.isDestroyed()) {
            this.sender.send('stats:remote', { tabId: this.tabId, stats })
          }
        } catch {
          /* a bad sample is not worth surfacing */
        }
        this.schedule()
      })
    })
  }

  private parse(output: string): RemoteStats | null {
    if (!output.includes('#END')) return null

    // --- cpu ---
    let usage = 0
    const sample = parseCpuSample(section(output, 'STAT'))
    if (sample && this.lastCpu) {
      const idleDelta = sample.idle - this.lastCpu.idle
      const totalDelta = sample.total - this.lastCpu.total
      if (totalDelta > 0) usage = Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
    }
    if (sample) this.lastCpu = sample

    // --- disk ---
    const dfCols = section(output, 'DF').split(/\s+/)
    const usedKb = Number(dfCols[2] ?? 0)
    const availKb = Number(dfCols[3] ?? 0)

    // --- network ---
    const counters = parseNetwork(output)
    const now = Date.now()
    let network = { rx: 0, tx: 0 }
    if (this.lastNet) {
      const seconds = (now - this.lastNet.at) / 1000
      if (seconds > 0) {
        network = {
          rx: Math.max(0, (counters.rx - this.lastNet.rx) / seconds),
          tx: Math.max(0, (counters.tx - this.lastNet.tx) / seconds)
        }
      }
    }
    this.lastNet = { ...counters, at: now }

    return {
      host: this.label,
      os: section(output, 'OS') || 'unknown',
      cpu: { usage, cores: Number(section(output, 'CPUS')) || 0 },
      memory: parseMemory(output),
      disk: {
        used: usedKb * 1024,
        total: (usedKb + availKb) * 1024,
        mount: dfCols[dfCols.length - 1] || '/'
      },
      network,
      load: parseLoad(output),
      uptime: Number(section(output, 'UP')) || 0
    }
  }
}
