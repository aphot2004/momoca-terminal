import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiscoveredHost, PingSample, PingSummary, PortResult } from '@shared/types'

interface Props {
  onClose: () => void
  /** Which tool the panel opens on; the Tools menu points straight at one. */
  initialTab?: NetworkTab
  /** Open an SSH session against a discovered host. */
  onConnect: (host: string, port: number) => void
}

export type NetworkTab = 'ping' | 'scan' | 'discover'
type Tab = NetworkTab

const PORT_PRESETS: Record<string, string> = {
  Common: '21,22,23,25,53,80,110,143,443,445,587,993,995,3306,3389,5432,5900,8080,8443',
  Web: '80,443,3000,8000,8080,8443,9000',
  Databases: '1433,1521,3306,5432,6379,9200,11211,27017',
  'Top 1024': '1-1024'
}

function ms(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(value < 10 ? 2 : 0)} ms`
}

export function NetworkTools({ onClose, onConnect, initialTab = 'ping' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)

  // Shared job control: only one scan/ping/sweep at a time.
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobRef = useRef<string | null>(null)
  jobRef.current = jobId

  const running = jobId !== null

  const cancel = useCallback(() => {
    if (jobRef.current) void window.api.net.cancel(jobRef.current)
  }, [])

  // Cancel anything in flight if the panel closes.
  useEffect(() => cancel, [cancel])

  // --- ping ---------------------------------------------------------------
  const [pingHost, setPingHost] = useState('1.1.1.1')
  const [pingCount, setPingCount] = useState(5)
  const [samples, setSamples] = useState<PingSample[]>([])
  const [summary, setSummary] = useState<PingSummary | null>(null)

  useEffect(
    () =>
      window.api.net.onPing((p) => {
        if (p.jobId !== jobRef.current) return
        if (p.sample) setSamples((current) => [...current, p.sample!])
        if (p.finished) {
          setSummary(p.summary ?? null)
          if (p.error) setError(p.error)
          setJobId(null)
        }
      }),
    []
  )

  const startPing = async () => {
    setError(null)
    setSamples([])
    setSummary(null)
    try {
      const { jobId: id } = await window.api.net.ping(pingHost.trim(), pingCount)
      setJobId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- port scan ----------------------------------------------------------
  const [scanHost, setScanHost] = useState('127.0.0.1')
  const [ports, setPorts] = useState(PORT_PRESETS.Common)
  const [open, setOpen] = useState<PortResult[]>([])
  const [scanned, setScanned] = useState({ done: 0, total: 0 })

  useEffect(
    () =>
      window.api.net.onScan((p) => {
        if (p.jobId !== jobRef.current) return
        setScanned({ done: p.done, total: p.total })
        if (p.result) setOpen((current) => [...current, p.result!])
        if (p.finished) {
          if (p.open) setOpen(p.open)
          setJobId(null)
        }
      }),
    []
  )

  const startScan = async () => {
    setError(null)
    setOpen([])
    setScanned({ done: 0, total: 0 })
    try {
      const { jobId: id } = await window.api.net.scan({ host: scanHost.trim(), ports })
      setJobId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // --- discovery ----------------------------------------------------------
  const [cidr, setCidr] = useState('')
  const [hosts, setHosts] = useState<DiscoveredHost[]>([])
  const [swept, setSwept] = useState({ done: 0, total: 0 })

  useEffect(() => {
    void window.api.net.localNetworks().then((nets) => {
      if (nets[0]) setCidr(nets[0].cidr)
    })
  }, [])

  useEffect(
    () =>
      window.api.net.onDiscover((p) => {
        if (p.jobId !== jobRef.current) return
        setSwept({ done: p.done, total: p.total })
        if (p.host) setHosts((current) => [...current, p.host!])
        if (p.finished) {
          if (p.hosts) setHosts(p.hosts)
          setJobId(null)
        }
      }),
    []
  )

  const startDiscover = async () => {
    setError(null)
    setHosts([])
    setSwept({ done: 0, total: 0 })
    try {
      const { jobId: id } = await window.api.net.discover(cidr.trim())
      setJobId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const progress = tab === 'scan' ? scanned : tab === 'discover' ? swept : null

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Network tools</h2>

        <div className="panel-tabs inline">
          {(['ping', 'scan', 'discover'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`panel-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
              disabled={running}
              title={running ? 'Finish or stop the running job first' : undefined}
            >
              {t === 'ping' ? 'Ping' : t === 'scan' ? 'Port scan' : 'Discover'}
            </button>
          ))}
        </div>

        {error && <div className="warning">{error}</div>}

        {/* ---------- ping ---------- */}
        {tab === 'ping' && (
          <>
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>Host</label>
                <input
                  value={pingHost}
                  onChange={(e) => setPingHost(e.target.value)}
                  disabled={running}
                  onKeyDown={(e) => e.key === 'Enter' && !running && void startPing()}
                />
              </div>
              <div className="field" style={{ width: 90 }}>
                <label>Count</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={pingCount}
                  onChange={(e) => setPingCount(Number(e.target.value) || 1)}
                  disabled={running}
                />
              </div>
            </div>

            <div className="net-results">
              {!samples.length && !running && <div className="muted-row">No replies yet.</div>}
              {samples.map((s, i) => (
                <div key={i} className="net-row">
                  <span className={`status-dot ${s.ms === null ? 'error' : 'ready'}`} />
                  <span className="mono">seq {s.seq}</span>
                  <span className="mono dim">ttl {s.ttl || '—'}</span>
                  <span className="mono net-time">{ms(s.ms)}</span>
                </div>
              ))}
            </div>

            {summary && (
              <p className="hint">
                {summary.received}/{summary.sent} replies · {Math.round(summary.loss * 100)}% loss
                {summary.avg !== null && ` · min ${ms(summary.min)} avg ${ms(summary.avg)} max ${ms(summary.max)}`}
              </p>
            )}
          </>
        )}

        {/* ---------- port scan ---------- */}
        {tab === 'scan' && (
          <>
            <div className="field">
              <label>Host</label>
              <input
                value={scanHost}
                onChange={(e) => setScanHost(e.target.value)}
                disabled={running}
              />
            </div>
            <div className="field">
              <label>Ports</label>
              <input
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                disabled={running}
                spellCheck={false}
              />
            </div>
            <div className="preset-row">
              {Object.entries(PORT_PRESETS).map(([label, value]) => (
                <button
                  key={label}
                  className="btn ghost"
                  disabled={running}
                  onClick={() => setPorts(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="net-results">
              {!open.length && !running && <div className="muted-row">No open ports found yet.</div>}
              {open.map((r) => (
                <div key={r.port} className="net-row">
                  <span className="status-dot ready" />
                  <span className="mono">{r.port}</span>
                  <span className="dim">{r.service ?? 'unknown'}</span>
                  <span className="mono net-time">{ms(r.ms)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------- discovery ---------- */}
        {tab === 'discover' && (
          <>
            <div className="field">
              <label>Subnet (CIDR)</label>
              <input
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                disabled={running}
                placeholder="192.168.1.0/24"
                spellCheck={false}
              />
            </div>
            <p className="hint">
              Pings every address, then tries a few common TCP ports on the ones that stay
              quiet — firewalled hosts often ignore ICMP but still answer on 22 or 443.
            </p>

            <div className="net-results">
              {!hosts.length && !running && <div className="muted-row">No hosts found yet.</div>}
              {hosts.map((h) => (
                <div key={h.ip} className="net-row">
                  <span className="status-dot ready" />
                  <span className="mono">{h.ip}</span>
                  <span className="dim ellipsis">{h.hostname ?? h.mac ?? ''}</span>
                  <span className="dim">{h.via}</span>
                  <span className="mono net-time">{ms(h.ms)}</span>
                  <button className="btn ghost" onClick={() => onConnect(h.ip, 22)}>
                    SSH
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {progress && progress.total > 0 && (
          <div className="transfer">
            <div className="transfer-line">
              {progress.done} / {progress.total}
            </div>
            <span className="meter">
              <span
                className="meter-fill ok"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </span>
          </div>
        )}

        <div className="modal-actions">
          {running ? (
            <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={cancel}>
              Stop
            </button>
          ) : (
            <span style={{ marginRight: 'auto' }} />
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={running}
            onClick={() =>
              void (tab === 'ping' ? startPing() : tab === 'scan' ? startScan() : startDiscover())
            }
          >
            {running ? 'Running…' : tab === 'ping' ? 'Ping' : tab === 'scan' ? 'Scan' : 'Sweep'}
          </button>
        </div>
      </div>
    </div>
  )
}
