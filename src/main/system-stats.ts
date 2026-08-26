import { exec } from 'node:child_process'
import { cpus, loadavg, totalmem, uptime } from 'node:os'
import { promisify } from 'node:util'
import type { SystemStats } from '@shared/types'

const run = promisify(exec)

interface CpuSample {
  idle: number
  total: number
}

function sampleCpu(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    for (const value of Object.values(cpu.times)) total += value
    idle += cpu.times.idle
  }
  return { idle, total }
}

let lastCpu = sampleCpu()
let lastNet: { rx: number; tx: number; at: number } | null = null

/**
 * macOS `os.freemem()` counts only genuinely free pages, so it reports ~95%
 * used on an idle machine. Activity Monitor's figure is closer to
 * active + wired + compressed, which is what we derive from `vm_stat`.
 */
async function readMemory(): Promise<{ used: number; total: number }> {
  const total = totalmem()
  try {
    const { stdout } = await run('vm_stat')
    const pageSize = Number(/page size of (\d+) bytes/.exec(stdout)?.[1] ?? 4096)
    const pages = (label: string) =>
      Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] ?? 0)

    const used =
      (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) *
      pageSize

    return { used: Math.min(used, total), total }
  } catch {
    return { used: 0, total }
  }
}

/**
 * On modern macOS `/` is a read-only system snapshot — it reports ~14% used
 * while the user's actual data volume sits at 62%. Report the Data volume when
 * it exists, and derive capacity as used/(used+avail) the way `df` and Finder
 * do, since APFS containers share free space and `total` overstates the share.
 */
async function readDisk(): Promise<{ used: number; total: number; mount: string }> {
  try {
    const { stdout } = await run('df -k /System/Volumes/Data 2>/dev/null || df -k /')
    const line = stdout.trim().split('\n').pop() ?? ''
    const parts = line.split(/\s+/)
    const usedKb = Number(parts[2] ?? 0)
    const availKb = Number(parts[3] ?? 0)
    return {
      used: usedKb * 1024,
      total: (usedKb + availKb) * 1024,
      mount: parts[parts.length - 1] || '/'
    }
  } catch {
    return { used: 0, total: 0, mount: '/' }
  }
}

/** Bytes/sec, derived by diffing cumulative interface counters between polls. */
async function readNetwork(): Promise<{ rx: number; tx: number }> {
  try {
    const { stdout } = await run('netstat -ibn')
    let rx = 0
    let tx = 0
    const seen = new Set<string>()

    for (const line of stdout.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 10) continue
      const name = cols[0]
      // netstat repeats each interface per address family; count it once.
      if (name === 'lo0' || seen.has(name)) continue
      seen.add(name)
      rx += Number(cols[6]) || 0
      tx += Number(cols[9]) || 0
    }

    const now = Date.now()
    if (!lastNet) {
      lastNet = { rx, tx, at: now }
      return { rx: 0, tx: 0 }
    }

    const seconds = (now - lastNet.at) / 1000
    const rate = {
      rx: seconds > 0 ? Math.max(0, (rx - lastNet.rx) / seconds) : 0,
      tx: seconds > 0 ? Math.max(0, (tx - lastNet.tx) / seconds) : 0
    }
    lastNet = { rx, tx, at: now }
    return rate
  } catch {
    return { rx: 0, tx: 0 }
  }
}

export async function collectStats(): Promise<SystemStats> {
  const current = sampleCpu()
  const idleDelta = current.idle - lastCpu.idle
  const totalDelta = current.total - lastCpu.total
  lastCpu = current

  const [memory, disk, network] = await Promise.all([readMemory(), readDisk(), readNetwork()])
  const cores = cpus()

  return {
    cpu: {
      usage: totalDelta > 0 ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta)) : 0,
      cores: cores.length,
      model: cores[0]?.model ?? 'CPU'
    },
    memory,
    disk,
    network,
    load: loadavg() as [number, number, number],
    uptime: uptime()
  }
}
