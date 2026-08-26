import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { UnixTool, UnixToolGroup } from '@shared/types'

const run = promisify(execFile)

/**
 * MobaXterm's "Unix command set" exists because Windows has no Unix userland —
 * it ships a busybox-style bundle to fill the gap. macOS already has one, so
 * bundling binaries here would be pointless.
 *
 * The gap that *does* exist on a Mac is different: the shipped tools are the BSD
 * variants, whose flags differ from the GNU ones most Linux documentation
 * assumes, and a handful of everyday utilities simply aren't present. So this
 * reports what you have, flags where the BSD version will surprise you, and
 * gives the one-liner to install the rest.
 */
interface ToolDef {
  name: string
  group: UnixToolGroup
  purpose: string
  /** Homebrew formula, when the tool isn't part of macOS. */
  formula?: string
  /** Set when macOS ships a BSD variant that behaves differently from GNU's. */
  bsdCaveat?: string
}

const TOOLS: ToolDef[] = [
  // --- files ---
  { name: 'ls', group: 'files', purpose: 'List directory contents', bsdCaveat: 'BSD ls: no --color=auto; use -G' },
  { name: 'cp', group: 'files', purpose: 'Copy files' },
  { name: 'mv', group: 'files', purpose: 'Move and rename' },
  { name: 'rm', group: 'files', purpose: 'Remove files' },
  { name: 'find', group: 'files', purpose: 'Search the filesystem', bsdCaveat: 'BSD find requires a path before predicates' },
  { name: 'tree', group: 'files', purpose: 'Directory tree view', formula: 'tree' },
  { name: 'ncdu', group: 'files', purpose: 'Interactive disk usage', formula: 'ncdu' },
  { name: 'rsync', group: 'files', purpose: 'Incremental file sync', bsdCaveat: 'macOS ships rsync 2.6.9 (2006); brew install rsync for v3' },

  // --- text ---
  { name: 'grep', group: 'text', purpose: 'Search text with patterns', bsdCaveat: 'BSD grep lacks -P (Perl regex); use ggrep' },
  { name: 'sed', group: 'text', purpose: 'Stream editor', bsdCaveat: 'BSD sed needs -i \'\' for in-place edits' },
  { name: 'awk', group: 'text', purpose: 'Field-oriented processing' },
  { name: 'jq', group: 'text', purpose: 'JSON processor', formula: 'jq' },
  { name: 'rg', group: 'text', purpose: 'ripgrep — fast recursive search', formula: 'ripgrep' },
  { name: 'diff', group: 'text', purpose: 'Compare files' },
  { name: 'less', group: 'text', purpose: 'Pager' },

  // --- network ---
  { name: 'curl', group: 'network', purpose: 'HTTP client' },
  { name: 'wget', group: 'network', purpose: 'Recursive downloader', formula: 'wget' },
  { name: 'dig', group: 'network', purpose: 'DNS lookup' },
  { name: 'nc', group: 'network', purpose: 'netcat — raw TCP/UDP' },
  { name: 'nmap', group: 'network', purpose: 'Network and port scanner', formula: 'nmap' },
  { name: 'tcpdump', group: 'network', purpose: 'Packet capture' },
  { name: 'mtr', group: 'network', purpose: 'Traceroute + ping combined', formula: 'mtr' },
  { name: 'ssh', group: 'network', purpose: 'Secure shell' },
  { name: 'scp', group: 'network', purpose: 'Copy over SSH' },

  // --- system ---
  { name: 'htop', group: 'system', purpose: 'Interactive process viewer', formula: 'htop' },
  { name: 'watch', group: 'system', purpose: 'Re-run a command periodically', formula: 'watch' },
  { name: 'lsof', group: 'system', purpose: 'List open files and sockets' },
  { name: 'ps', group: 'system', purpose: 'Process status' },
  { name: 'tmux', group: 'system', purpose: 'Terminal multiplexer', formula: 'tmux' },

  // --- archives ---
  { name: 'tar', group: 'archives', purpose: 'Archive files' },
  { name: 'zip', group: 'archives', purpose: 'Create zip archives' },
  { name: 'unzip', group: 'archives', purpose: 'Extract zip archives' },
  { name: 'gzip', group: 'archives', purpose: 'Compress with gzip' },

  // --- gnu coreutils ---
  {
    name: 'gls',
    group: 'gnu',
    purpose: 'GNU ls, alongside the BSD one',
    formula: 'coreutils'
  },
  { name: 'gsed', group: 'gnu', purpose: 'GNU sed — in-place edits without the empty arg', formula: 'gnu-sed' },
  { name: 'ggrep', group: 'gnu', purpose: 'GNU grep — supports -P', formula: 'grep' },
  { name: 'gawk', group: 'gnu', purpose: 'GNU awk', formula: 'gawk' }
]

const PATH_WITH_BREW = `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`

async function detect(def: ToolDef): Promise<UnixTool> {
  let path: string | null = null
  try {
    const { stdout } = await run('/usr/bin/which', [def.name], {
      env: { ...process.env, PATH: PATH_WITH_BREW }
    })
    path = stdout.trim() || null
  } catch {
    path = null
  }

  let version: string | undefined
  if (path) {
    // Most tools answer --version; the BSD ones often don't, and that's fine.
    try {
      const { stdout, stderr } = await run(path, ['--version'], {
        env: { ...process.env, PATH: PATH_WITH_BREW },
        timeout: 1500
      })
      version = (stdout || stderr).split('\n')[0]?.trim().slice(0, 80) || undefined
    } catch {
      version = undefined
    }
  }

  return {
    name: def.name,
    group: def.group,
    purpose: def.purpose,
    available: Boolean(path),
    path: path ?? undefined,
    version,
    formula: def.formula,
    bsdCaveat: def.bsdCaveat
  }
}

export async function checkUnixTools(): Promise<UnixTool[]> {
  return Promise.all(TOOLS.map(detect))
}
