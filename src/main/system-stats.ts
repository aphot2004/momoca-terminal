import { exec } from 'node:child_process'
import { cpus, loadavg, totalmem, uptime } from 'node:os'
import { promisify } from 'node:util'
import type { StatsDetail, SystemStats } from '@shared/types'

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
let lastCores = perCoreSample()

/** Busy/total per core, so the hover can show them individually. */
function perCoreSample(): { idle: number; total: number }[] {
  return cpus().map((cpu) => {
    let total = 0
    for (const value of Object.values(cpu.times)) total += value
    return { idle: cpu.times.idle, total }
  })
}
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

/**
 * The per-meter detail, gathered on the same tick as the summary.
 *
 * Every probe is allowed to fail on its own: a machine without `iostat`, or a
 * `ps` that returns something unexpected, must not cost the whole bar. Each
 * returns undefined and the popover simply shows less.
 */
async function collectDetail(): Promise<StatsDetail> {
  const detail: StatsDetail = {}

  // Per-core, from the same counters Node already exposes.
  const cores = perCoreSample()
  detail.cores = cores.map((core, i) => {
    const previous = lastCores[i]
    if (!previous) return 0
    const idleDelta = core.idle - previous.idle
    const totalDelta = core.total - previous.total
    return totalDelta > 0 ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta)) : 0
  })
  lastCores = cores

  // Top processes, one ps for each ordering. rss is in kilobytes.
  await Promise.all([
    run('/bin/ps -axo rss=,pid=,comm= -r | sort -rn -k1 | head -8')
      .then(({ stdout }) => {
        detail.topMemory = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [, rss, pid, name] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? []
            return { name: shortName(name ?? ''), pid: Number(pid), bytes: Number(rss) * 1024 }
          })
          .filter((x) => x.pid)
      })
      .catch(() => undefined),

    run('/bin/ps -axo pcpu=,pid=,comm= -r | head -8')
      .then(({ stdout }) => {
        detail.topCpu = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [, pcpu, pid, name] = /^\s*([\d.]+)\s+(\d+)\s+(.*)$/.exec(line) ?? []
            return { name: shortName(name ?? ''), pid: Number(pid), percent: Number(pcpu) }
          })
          .filter((x) => x.pid)
      })
      .catch(() => undefined),

    // Real filesystems only: df lists a long tail of synthetic mounts.
    run('/bin/df -k')
      .then(({ stdout }) => {
        detail.volumes = stdout
          .trim()
          .split('\n')
          .slice(1)
          .map((line) => line.trim().split(/\s+/))
          .filter((f) => f[0]?.startsWith('/dev/'))
          .map((f) => ({
            device: f[0],
            mount: f.slice(8).join(' ') || f[f.length - 1],
            used: Number(f[2]) * 1024,
            total: Number(f[1]) * 1024
          }))
          .filter((v) => v.total > 0)
      })
      .catch(() => undefined),

    // iostat reports throughput but never splits read from write; the IO
    // registry's per-driver Statistics block does, and is what Activity
    // Monitor reads. Summed across every block device.
    run('/usr/sbin/ioreg -c IOBlockStorageDriver -r -d 1 -w0')
      .then(({ stdout }) => {
        let read = 0
        let written = 0
        for (const [, n] of stdout.matchAll(/"Bytes \(Read\)"=(\d+)/g)) read += Number(n)
        for (const [, n] of stdout.matchAll(/"Bytes \(Write\)"=(\d+)/g)) written += Number(n)
        if (read || written) detail.diskIo = { read, written }
      })
      .catch(() => undefined),

    run('/usr/sbin/netstat -ibn')
      .then(({ stdout }) => {
        const seen = new Map<string, { name: string; rx: number; tx: number; address?: string }>()
        for (const line of stdout.trim().split('\n').slice(1)) {
          const f = line.trim().split(/\s+/)
          const name = f[0]
          // The <Link#n> rows carry the byte counters. They also leave the
          // Address column empty, so every field after Network shifts left by
          // one against the header — hence 2, 5 and 8 rather than 3, 6 and 9.
          if (!name || !f[2]?.startsWith('<Link')) continue
          const rx = Number(f[5])
          const tx = Number(f[8])
          if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue
          if (rx === 0 && tx === 0) continue
          seen.set(name, { name, rx, tx })
        }
        // Attach the first IPv4 address for each, purely to make it recognisable.
        for (const line of stdout.trim().split('\n').slice(1)) {
          const f = line.trim().split(/\s+/)
          const entry = f[0] ? seen.get(f[0]) : undefined
          if (entry && !entry.address && /^\d+\.\d+\.\d+\.\d+$/.test(f[3] ?? '')) {
            entry.address = f[3]
          }
        }
        detail.interfaces = [...seen.values()].sort((a, b) => b.rx + b.tx - (a.rx + a.tx))
      })
      .catch(() => undefined)
  ])

  return detail
}

/** `ps` gives a full path for many processes; the basename is what reads. */
function shortName(command: string): string {
  return command.split('/').pop() || command
}

export async function collectStats(): Promise<SystemStats> {
  const current = sampleCpu()
  const idleDelta = current.idle - lastCpu.idle
  const totalDelta = current.total - lastCpu.total
  lastCpu = current

  const [memory, disk, network, detail] = await Promise.all([
    readMemory(),
    readDisk(),
    readNetwork(),
    collectDetail()
  ])
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
    uptime: uptime(),
    detail
  }
}
