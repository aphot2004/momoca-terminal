import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProcessInfo } from '@shared/types'
import { useExclusive } from '../../hooks/useExclusive'

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit++
  }
  return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`
}

export function ProcessTool() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { run: exclusive } = useExclusive()

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setProcesses(await window.api.toolbox.processes())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const list = needle
      ? processes.filter(
          (p) => p.command.toLowerCase().includes(needle) || String(p.pid) === needle
        )
      : processes
    return list.slice(0, 300)
  }, [processes, filter])

  const signal = (proc: ProcessInfo, sig: 'TERM' | 'KILL') =>
    void exclusive(async () => {
      if (
        !window.confirm(
          `Send SIG${sig} to ${proc.pid} (${proc.command.split('/').pop()})?` +
            (sig === 'KILL' ? '\n\nSIGKILL cannot be caught — unsaved work is lost.' : '')
        )
      )
        return
      try {
        await window.api.toolbox.kill(proc.pid, sig)
        setError(null)
        // Give it a moment to actually go before re-reading.
        setTimeout(() => void refresh(), 400)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

  return (
    <>
      {error && <div className="warning">{error}</div>}

      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Filter by name or PID</label>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ alignSelf: 'end' }}>
          <button className="btn" onClick={() => void refresh()}>
            {busy ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <p className="hint">
        {shown.length} of {processes.length} processes, busiest first. You can only signal your own
        processes — anything owned by root needs a root shell.
      </p>

      <div className="tool-table">
        <div className="tool-thead proc-grid">
          <span>PID</span>
          <span>User</span>
          <span>CPU</span>
          <span>Memory</span>
          <span>Command</span>
          <span />
        </div>
        <div className="tool-tbody">
          {shown.map((proc) => (
            <div key={proc.pid} className="tool-trow proc-grid">
              <span className="mono">{proc.pid}</span>
              <span className="dim">{proc.user}</span>
              <span className="mono">{proc.cpu.toFixed(1)}%</span>
              <span className="mono">{bytes(proc.rss)}</span>
              <span className="mono ellipsis" title={proc.command}>
                {proc.command}
              </span>
              <span className="proc-actions">
                <button className="btn ghost" onClick={() => signal(proc, 'TERM')} title="SIGTERM">
                  Quit
                </button>
                <button
                  className="btn ghost danger"
                  onClick={() => signal(proc, 'KILL')}
                  title="SIGKILL"
                >
                  Kill
                </button>
              </span>
            </div>
          ))}
          {!shown.length && <div className="muted-row">Nothing matches.</div>}
        </div>
      </div>
    </>
  )
}
