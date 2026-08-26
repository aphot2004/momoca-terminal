import { useCallback, useEffect, useState } from 'react'
import type { ListeningPort } from '@shared/types'

export function PortsTool() {
  const [ports, setPorts] = useState<ListeningPort[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setPorts(await window.api.toolbox.ports())
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

  return (
    <>
      {error && <div className="warning">{error}</div>}

      <p className="hint">
        TCP sockets in LISTEN state on this Mac, from <code>lsof</code>. Ports owned by other users
        may be hidden unless the app is run with more privilege.
      </p>

      <div className="tool-table">
        <div className="tool-thead port-grid">
          <span>Port</span>
          <span>Process</span>
          <span>PID</span>
          <span>User</span>
          <span>Address</span>
        </div>
        <div className="tool-tbody">
          {ports.map((p) => (
            <div key={`${p.pid}-${p.address}`} className="tool-trow port-grid">
              <span className="mono">{p.port}</span>
              <span className="ellipsis">{p.command}</span>
              <span className="mono dim">{p.pid}</span>
              <span className="dim">{p.user}</span>
              <span className="mono ellipsis dim">{p.address}</span>
            </div>
          ))}
          {!ports.length && !busy && <div className="muted-row">Nothing listening.</div>}
        </div>
      </div>

      <button className="btn" style={{ marginTop: 10 }} onClick={() => void refresh()}>
        {busy ? 'Reading…' : 'Refresh'}
      </button>
    </>
  )
}
