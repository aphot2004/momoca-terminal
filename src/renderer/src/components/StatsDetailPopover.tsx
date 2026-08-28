import { useLayoutEffect, useRef, useState } from 'react'
import type { StatsDetail } from '@shared/types'

export type MetricId = 'cpu' | 'memory' | 'disk' | 'network' | 'load' | 'uptime'

interface Props {
  metric: MetricId
  detail: StatsDetail | undefined
  /** Uptime in seconds; the only metric whose detail is pure arithmetic. */
  uptime: number
  cores: number
  /** Anchor: the meter's own rectangle, so the popover sits over it. */
  anchor: DOMRect
}

function bytes(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit++
  }
  return `${scaled.toFixed(scaled < 10 ? digits : 0)} ${units[unit]}`
}

/** A row of label, bar and value — the bar's own vocabulary, one level down. */
function Row({ name, ratio, value }: { name: string; ratio?: number; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-name">{name}</span>
      {ratio !== undefined && (
        <span className="detail-meter">
          <span
            className="detail-fill"
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </span>
      )}
      <span className="detail-value">{value}</span>
    </div>
  )
}

function Empty({ what }: { what: string }) {
  return <div className="detail-empty">This host did not report {what}.</div>
}

/**
 * Every uptime unit at once, because "3d 4h" hides the number you happened to
 * want. Months and years are the conventional approximations — 30 and 365 days
 * — which is the only honest way to say them without a calendar.
 */
function uptimeRows(seconds: number): { name: string; value: string }[] {
  const whole = Math.floor(seconds)
  return [
    { name: 'Years', value: (whole / 31_536_000).toFixed(2) },
    { name: 'Months', value: (whole / 2_592_000).toFixed(2) },
    { name: 'Weeks', value: (whole / 604_800).toFixed(2) },
    { name: 'Days', value: (whole / 86_400).toFixed(2) },
    { name: 'Hours', value: (whole / 3_600).toFixed(1) },
    { name: 'Minutes', value: Math.floor(whole / 60).toLocaleString() },
    { name: 'Seconds', value: whole.toLocaleString() }
  ]
}

const TITLES: Record<MetricId, string> = {
  cpu: 'Processor',
  memory: 'Memory',
  disk: 'Storage',
  network: 'Network interfaces',
  load: 'Load',
  uptime: 'Uptime'
}

export function StatsDetailPopover({ metric, detail, uptime, cores, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Placed above the bar, and nudged back inside when it would overhang.
  const [pos, setPos] = useState({ left: anchor.left, bottom: 0, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width } = el.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - 8
    )
    setPos({ left, bottom: window.innerHeight - anchor.top + 6, ready: true })
  }, [anchor.left, anchor.top, anchor.width, metric])

  const body = (() => {
    switch (metric) {
      case 'cpu': {
        if (!detail?.cores?.length) return <Empty what="per-core usage" />
        return (
          <>
            {detail.cores.map((busy, i) => (
              <Row key={i} name={`Core ${i}`} ratio={busy} value={`${Math.round(busy * 100)}%`} />
            ))}
          </>
        )
      }
      case 'memory': {
        if (!detail?.topMemory?.length) return <Empty what="its process list" />
        const largest = detail.topMemory[0]?.bytes || 1
        return (
          <>
            {detail.topMemory.map((p) => (
              <Row
                key={p.pid}
                name={p.name}
                ratio={p.bytes / largest}
                value={bytes(p.bytes, 0)}
              />
            ))}
          </>
        )
      }
      case 'disk': {
        if (!detail?.volumes?.length && !detail?.diskIo) return <Empty what="its volumes" />
        return (
          <>
            {detail.diskIo && (
              <Row
                name="Read since boot"
                value={bytes(detail.diskIo.read)}
              />
            )}
            {detail.diskIo && detail.diskIo.written > 0 && (
              <Row name="Written since boot" value={bytes(detail.diskIo.written)} />
            )}
            {detail.volumes?.map((v) => (
              <Row
                key={v.mount}
                name={v.mount}
                ratio={v.total ? v.used / v.total : 0}
                value={`${bytes(v.used, 0)} of ${bytes(v.total, 0)} · ${bytes(v.total - v.used, 0)} free`}
              />
            ))}
          </>
        )
      }
      case 'network': {
        if (!detail?.interfaces?.length) return <Empty what="its interfaces" />
        return (
          <>
            {detail.interfaces.map((n) => (
              <Row
                key={n.name}
                name={n.address ? `${n.name} · ${n.address}` : n.name}
                value={`↓ ${bytes(n.rx, 0)}  ↑ ${bytes(n.tx, 0)}`}
              />
            ))}
          </>
        )
      }
      case 'load': {
        if (!detail?.topCpu?.length) return <Empty what="its process list" />
        return (
          <>
            {detail.topCpu.map((p) => (
              <Row
                key={p.pid}
                name={p.name}
                // Against one core, so a busy process can legitimately exceed it.
                ratio={p.percent / 100}
                value={`${p.percent.toFixed(1)}%`}
              />
            ))}
          </>
        )
      }
      case 'uptime':
        return (
          <>
            {uptimeRows(uptime).map((r) => (
              <Row key={r.name} name={r.name} value={r.value} />
            ))}
          </>
        )
    }
  })()

  return (
    <div
      className="stats-detail"
      ref={ref}
      style={{ left: pos.left, bottom: pos.bottom, visibility: pos.ready ? 'visible' : 'hidden' }}
      role="tooltip"
    >
      <div className="detail-title">
        {TITLES[metric]}
        {metric === 'cpu' && cores > 0 && <span className="detail-sub">{cores} cores</span>}
        {metric === 'memory' && <span className="detail-sub">top by resident size</span>}
        {metric === 'load' && <span className="detail-sub">top by CPU</span>}
      </div>
      {body}
    </div>
  )
}
