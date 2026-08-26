import type { RemoteStats, SystemStats } from '@shared/types'

function bytes(value: number, digits = 1): string {
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit++
  }
  return `${scaled.toFixed(scaled < 10 ? digits : 0)} ${units[unit]}`
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** Colour shifts to amber then red as a meter fills, so trouble reads at a glance. */
function severity(ratio: number): string {
  if (ratio >= 0.9) return 'crit'
  if (ratio >= 0.7) return 'warn'
  return 'ok'
}

function Meter({
  label,
  ratio,
  value,
  title
}: {
  label: string
  ratio: number
  value: string
  title?: string
}) {
  const clamped = Math.min(1, Math.max(0, ratio))
  return (
    <div className="metric" title={title}>
      <span className="metric-label">{label}</span>
      <span className="meter">
        <span className={`meter-fill ${severity(clamped)}`} style={{ width: `${clamped * 100}%` }} />
      </span>
      <span className="metric-value">{value}</span>
    </div>
  )
}

interface Props {
  local: SystemStats | null
  /** Metrics for the active SSH tab's server, when there is one. */
  remote: RemoteStats | null
  /** Show the local machine even while a remote session is open. */
  showLocal: boolean
  onToggleScope: () => void
}

/**
 * Reports the machine you're working on: the connected server whenever an SSH
 * tab is focused, this Mac otherwise. The scope chip flips between the two.
 */
export function StatsBar({ local, remote, showLocal, onToggleScope }: Props) {
  const usingRemote = Boolean(remote) && !showLocal
  const stats: SystemStats | RemoteStats | null = usingRemote ? remote : local

  const scopeLabel = usingRemote ? (remote as RemoteStats).host : 'This Mac'
  const scopeTitle = remote
    ? showLocal
      ? `Showing this Mac — click to show ${remote.host}`
      : `Showing ${remote.host} (${remote.os}) — click to show this Mac`
    : 'No SSH session focused, showing this Mac'

  if (!stats) {
    return (
      <div className="statsbar">
        <span className="metric-label">Collecting metrics…</span>
      </div>
    )
  }

  const memRatio = stats.memory.total ? stats.memory.used / stats.memory.total : 0
  const diskRatio = stats.disk.total ? stats.disk.used / stats.disk.total : 0
  const cores = stats.cpu.cores

  return (
    <div className="statsbar">
      <button
        className={`scope-chip${usingRemote ? ' remote' : ''}`}
        onClick={onToggleScope}
        disabled={!remote}
        title={scopeTitle}
      >
        {usingRemote ? '⇄' : '›_'} {scopeLabel}
      </button>

      <Meter
        label="CPU"
        ratio={stats.cpu.usage}
        value={`${Math.round(stats.cpu.usage * 100)}%`}
        title={cores ? `${cores} cores` : undefined}
      />
      <Meter
        label="RAM"
        ratio={memRatio}
        value={`${bytes(stats.memory.used)} / ${bytes(stats.memory.total, 0)}`}
      />
      <Meter
        label="Disk"
        ratio={diskRatio}
        value={`${bytes(stats.disk.used)} / ${bytes(stats.disk.total, 0)}`}
        title={`${Math.round(diskRatio * 100)}% of ${stats.disk.mount}`}
      />

      <div className="metric net" title="Throughput across all non-loopback interfaces">
        <span className="metric-label">Net</span>
        <span className="metric-value">
          <span className="net-rx">↓ {bytes(stats.network.rx)}/s</span>
          <span className="net-tx">↑ {bytes(stats.network.tx)}/s</span>
        </span>
      </div>

      <div className="metric" title="1, 5 and 15 minute load averages">
        <span className="metric-label">Load</span>
        <span className="metric-value">{stats.load.map((n) => n.toFixed(2)).join('  ')}</span>
      </div>

      <div className="metric" title="Uptime">
        <span className="metric-label">Up</span>
        <span className="metric-value">{duration(stats.uptime)}</span>
      </div>
    </div>
  )
}
