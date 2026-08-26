import { execFile } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrewPackage, HardwareInfo, ListeningPort, ProcessInfo } from '@shared/types'

const run = promisify(execFile)

const PATH_WITH_BREW = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
const env = { ...process.env, PATH: PATH_WITH_BREW }

// --- processes -------------------------------------------------------------

/**
 * MobaXterm's "List running processes". `ps` output is column-aligned with the
 * command last, so the command is taken as the remainder of the line rather
 * than by splitting on whitespace — arguments contain spaces.
 */
export async function listProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await run(
    '/bin/ps',
    ['-axo', 'pid=,ppid=,user=,pcpu=,pmem=,rss=,etime=,comm='],
    { env, maxBuffer: 8 * 1024 * 1024 }
  )

  const processes: ProcessInfo[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      user: match[3],
      cpu: Number(match[4]),
      mem: Number(match[5]),
      rss: Number(match[6]) * 1024,
      elapsed: match[7],
      command: match[8].trim()
    })
  }
  return processes.sort((a, b) => b.cpu - a.cpu)
}

/** PIDs that should never be signalled from a convenience UI. */
const PROTECTED_PIDS = new Set([0, 1])

export async function killProcess(pid: number, signal: string): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid PID')
  if (PROTECTED_PIDS.has(pid)) throw new Error(`Refusing to signal PID ${pid}`)
  if (pid === process.pid) throw new Error('That is this app — quit it from the menu instead')
  if (!/^(TERM|KILL|INT|HUP|QUIT)$/.test(signal)) throw new Error(`Unsupported signal ${signal}`)

  try {
    process.kill(pid, `SIG${signal}` as NodeJS.Signals)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM') throw new Error(`Not permitted — ${pid} belongs to another user or root`)
    if (code === 'ESRCH') throw new Error(`No such process ${pid}`)
    throw err
  }
}

// --- hardware --------------------------------------------------------------

/** MobaXterm's "List hardware devices", from sysctl and system_profiler. */
export async function hardwareInfo(): Promise<HardwareInfo> {
  const sysctl = async (key: string) => {
    try {
      const { stdout } = await run('/usr/sbin/sysctl', ['-n', key], { env })
      return stdout.trim()
    } catch {
      return ''
    }
  }

  const [model, cpu, cores, memBytes, osVersion, osBuild, uptimeRaw] = await Promise.all([
    sysctl('hw.model'),
    sysctl('machdep.cpu.brand_string'),
    sysctl('hw.ncpu'),
    sysctl('hw.memsize'),
    run('/usr/bin/sw_vers', ['-productVersion'], { env }).then((r) => r.stdout.trim()).catch(() => ''),
    run('/usr/bin/sw_vers', ['-buildVersion'], { env }).then((r) => r.stdout.trim()).catch(() => ''),
    sysctl('kern.boottime')
  ])

  // Disks and displays come from system_profiler, which is slow; ask only for
  // the two data types we render.
  const profile = async (type: string) => {
    try {
      const { stdout } = await run('/usr/sbin/system_profiler', ['-json', type], {
        env,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 12_000
      })
      return JSON.parse(stdout)
    } catch {
      return null
    }
  }

  const [storage, displays] = await Promise.all([
    profile('SPStorageDataType'),
    profile('SPDisplaysDataType')
  ])

  const disks = (storage?.SPStorageDataType ?? []).map((d: Record<string, unknown>) => ({
    name: String(d._name ?? 'disk'),
    sizeBytes: Number(d.size_in_bytes ?? 0),
    freeBytes: Number(d.free_space_in_bytes ?? 0),
    fs: String((d.file_system as string) ?? '')
  }))

  const gpus = (displays?.SPDisplaysDataType ?? []).map((g: Record<string, unknown>) =>
    String(g.sppci_model ?? g._name ?? 'GPU')
  )

  return {
    model,
    cpu,
    cores: Number(cores) || 0,
    memoryBytes: Number(memBytes) || 0,
    osVersion,
    osBuild,
    bootTime: /sec = (\d+)/.exec(uptimeRaw)?.[1] ?? '',
    disks,
    gpus
  }
}

// --- listening ports -------------------------------------------------------

/** MobaXterm's "List open network ports" / "Network services". */
export async function listeningPorts(): Promise<ListeningPort[]> {
  let stdout = ''
  try {
    // -P and -n keep ports and addresses numeric, which is much faster.
    const result = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      env,
      maxBuffer: 8 * 1024 * 1024
    })
    stdout = result.stdout
  } catch (err) {
    // lsof exits non-zero when some handles are unreadable; its output is
    // still usable, so only give up when there is nothing at all.
    stdout = (err as { stdout?: string }).stdout ?? ''
    if (!stdout) throw new Error('lsof returned nothing — it may need permission')
  }

  const ports: ListeningPort[] = []
  for (const line of stdout.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 9) continue
    const address = cols[cols.length - 2]
    const port = Number(/:(\d+)$/.exec(address)?.[1])
    if (!port) continue
    ports.push({
      command: cols[0],
      pid: Number(cols[1]),
      user: cols[2],
      address,
      port,
      protocol: cols[7] ?? 'TCP'
    })
  }
  return ports.sort((a, b) => a.port - b.port)
}

// --- wake on lan -----------------------------------------------------------

/**
 * A magic packet: six 0xFF bytes then the target MAC repeated sixteen times,
 * broadcast on the LAN. Nothing listens for a reply, so success here means
 * "sent", not "the machine woke".
 */
export async function wakeOnLan(mac: string, broadcast: string, port: number): Promise<void> {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '')
  if (clean.length !== 12) throw new Error(`"${mac}" is not a MAC address`)

  const bytes = Buffer.from(clean, 'hex')
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(bytes)])

  await new Promise<void>((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', (err) => {
      socket.close()
      reject(err)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(packet, port, broadcast || '255.255.255.255', (err) => {
        socket.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

// --- ssh key generation ----------------------------------------------------

/**
 * MobaXterm's MobaKeyGen. Shells out to `ssh-keygen` rather than assembling an
 * OpenSSH private key by hand — it is always present on macOS and is the
 * reference implementation of the format.
 */
export async function generateKey(input: {
  type: 'ed25519' | 'rsa' | 'ecdsa'
  bits?: number
  comment?: string
  passphrase?: string
}): Promise<{ privateKey: string; publicKey: string; fingerprint: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'mobaclone-keygen-'))
  const path = join(dir, 'id')

  try {
    const args = ['-t', input.type, '-f', path, '-N', input.passphrase ?? '', '-C', input.comment ?? '']
    if (input.type === 'rsa') args.push('-b', String(input.bits ?? 4096))
    if (input.type === 'ecdsa') args.push('-b', String(input.bits ?? 521))

    await run('/usr/bin/ssh-keygen', args, { env })

    const privateKey = readFileSync(path, 'utf8')
    const publicKey = readFileSync(`${path}.pub`, 'utf8').trim()
    const { stdout } = await run('/usr/bin/ssh-keygen', ['-lf', `${path}.pub`], { env })

    return { privateKey, publicKey, fingerprint: stdout.trim().split(/\s+/)[1] ?? '' }
  } finally {
    // The private key must not linger in a temp directory.
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- local files: editor and diff -----------------------------------------

const MAX_TEXT_BYTES = 8 * 1024 * 1024

export function readLocalText(path: string): string {
  const data = readFileSync(path)
  if (data.length > MAX_TEXT_BYTES) {
    throw new Error(`${Math.round(data.length / 1e6)} MB is too large to open here`)
  }
  return data.toString('utf8')
}

export function writeLocalText(path: string, contents: string): void {
  writeFileSync(path, contents, 'utf8')
}

/** MobaDiff's job, using the system `diff` rather than a hand-rolled LCS. */
export async function diffFiles(left: string, right: string): Promise<string> {
  try {
    const { stdout } = await run('/usr/bin/diff', ['-u', left, right], {
      env,
      maxBuffer: 8 * 1024 * 1024
    })
    return stdout || '(identical)'
  } catch (err) {
    // diff exits 1 when files differ, which is the interesting case.
    const e = err as { code?: number; stdout?: string; stderr?: string }
    if (e.code === 1 && e.stdout) return e.stdout
    throw new Error(e.stderr?.trim() || 'diff failed')
  }
}

// --- homebrew --------------------------------------------------------------

/** Stands in for MobApt: what Homebrew has installed, and what is outdated. */
export async function brewPackages(): Promise<{ available: boolean; packages: BrewPackage[] }> {
  try {
    const [installed, outdated] = await Promise.all([
      run('brew', ['list', '--versions'], { env, maxBuffer: 4 * 1024 * 1024, timeout: 20_000 }),
      run('brew', ['outdated', '--quiet'], { env, timeout: 20_000 }).catch(() => ({ stdout: '' }))
    ])

    const stale = new Set(outdated.stdout.split('\n').map((s) => s.trim()).filter(Boolean))

    const packages = installed.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, ...versions] = line.trim().split(/\s+/)
        return { name, version: versions.join(' '), outdated: stale.has(name) }
      })
      .sort((a, b) => Number(b.outdated) - Number(a.outdated) || a.name.localeCompare(b.name))

    return { available: true, packages }
  } catch {
    return { available: false, packages: [] }
  }
}
