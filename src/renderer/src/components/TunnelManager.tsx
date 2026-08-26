import { useCallback, useEffect, useState } from 'react'
import type { SavedSession, Tunnel, TunnelStatus, TunnelType } from '@shared/types'
import { useExclusive } from '../hooks/useExclusive'
import { TunnelExplainer } from './TunnelExplainer'

interface Props {
  sessions: SavedSession[]
  onClose: () => void
}

const BLANK = (sessionId: string): Omit<Tunnel, 'id'> => ({
  name: '',
  type: 'local',
  sessionId,
  listenHost: '127.0.0.1',
  listenPort: 8080,
  destHost: 'localhost',
  destPort: 80
})

const TYPE_LABEL: Record<TunnelType, string> = {
  local: 'Reach a remote service from this Mac  (-L)',
  remote: 'Expose something on this Mac to the server  (-R)',
  dynamic: 'Browse through the server (SOCKS proxy)  (-D)'
}

export function TunnelManager({ sessions, onClose }: Props) {
  const sshSessions = sessions.filter((s) => s.kind === 'ssh')

  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [statuses, setStatuses] = useState<Record<string, TunnelStatus>>({})
  const [draft, setDraft] = useState<Tunnel | Omit<Tunnel, 'id'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { busy: dialogBusy, run: exclusive } = useExclusive()

  const reload = useCallback(async () => {
    const [list, state] = await Promise.all([
      window.api.tunnels.list(),
      window.api.tunnels.status()
    ])
    setTunnels(list)
    setStatuses(Object.fromEntries(state.map((s) => [s.id, s])))
  }, [])

  useEffect(() => {
    void reload()
    return window.api.tunnels.onStatus((state) =>
      setStatuses(Object.fromEntries(state.map((s) => [s.id, s])))
    )
  }, [reload])

  const set = <K extends keyof Tunnel>(key: K, value: Tunnel[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  const save = async () => {
    if (!draft) return
    try {
      await window.api.tunnels.save(draft as Tunnel)
      setDraft(null)
      setError(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggle = async (tunnel: Tunnel) => {
    const state = statuses[tunnel.id]?.state ?? 'stopped'
    try {
      setError(null)
      if (state === 'running' || state === 'starting') await window.api.tunnels.stop(tunnel.id)
      else await window.api.tunnels.start(tunnel.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = (tunnel: Tunnel) =>
    void exclusive(async () => {
      if (!window.confirm(`Delete tunnel "${tunnel.name}"?`)) return
      await window.api.tunnels.remove(tunnel.id)
      await reload()
    })

  const describe = (t: Tunnel) =>
    t.type === 'dynamic'
      ? `socks5://${t.listenHost}:${t.listenPort}`
      : t.type === 'local'
        ? `${t.listenHost}:${t.listenPort} → ${t.destHost}:${t.destPort}`
        : `server ${t.listenHost}:${t.listenPort} → ${t.destHost}:${t.destPort}`

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>SSH tunnels</h2>

        {error && <div className="warning">{error}</div>}

        {!sshSessions.length && (
          <div className="warning">
            Tunnels run over a saved SSH session — create one first.
          </div>
        )}

        {draft && (
          <div className="inset">
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>Name</label>
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="db-forward"
                />
              </div>
              <div className="field" style={{ flex: 3 }}>
                <label>What do you want to do?</label>
                <select
                  value={draft.type}
                  onChange={(e) => set('type', e.target.value as TunnelType)}
                >
                  <option value="local">{TYPE_LABEL.local}</option>
                  <option value="remote">{TYPE_LABEL.remote}</option>
                  <option value="dynamic">{TYPE_LABEL.dynamic}</option>
                </select>
              </div>
            </div>

            <TunnelExplainer
              draft={draft}
              session={sshSessions.find((x) => x.id === draft.sessionId)}
            />

            <div className="field">
              <label>Through SSH session</label>
              <select
                value={draft.sessionId}
                onChange={(e) => set('sessionId', e.target.value)}
              >
                {sshSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.username}@{s.host})
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>
                  {draft.type === 'remote'
                    ? 'On the server, listen on'
                    : 'On this Mac, listen on'}
                </label>
                <input
                  value={draft.listenHost}
                  onChange={(e) => set('listenHost', e.target.value)}
                />
              </div>
              <div className="field" style={{ width: 96 }}>
                <label>Port</label>
                <input
                  type="number"
                  value={draft.listenPort}
                  onChange={(e) => set('listenPort', Number(e.target.value) || 0)}
                />
              </div>
            </div>

            {draft.type !== 'dynamic' && (
              <div className="field-row">
                <div className="field" style={{ flex: 2 }}>
                  <label>
                    {draft.type === 'remote'
                      ? 'Forward to, as seen from this Mac'
                      : 'Forward to, as seen from the server'}
                  </label>
                  <input
                    value={draft.destHost ?? ''}
                    onChange={(e) => set('destHost', e.target.value)}
                  />
                </div>
                <div className="field" style={{ width: 92 }}>
                  <label>Port</label>
                  <input
                    type="number"
                    value={draft.destPort ?? 0}
                    onChange={(e) => set('destPort', Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!draft.name.trim() || !draft.sessionId || !draft.listenPort}
                onClick={() => void save()}
              >
                Save tunnel
              </button>
            </div>
          </div>
        )}

        <div className="key-list">
          {!tunnels.length && <div className="muted-row">No tunnels configured.</div>}
          {tunnels.map((tunnel) => {
            const status = statuses[tunnel.id] ?? { state: 'stopped', connections: 0 }
            const running = status.state === 'running'
            return (
              <div key={tunnel.id} className="key-row">
                <span className={`status-dot ${running ? 'ready' : status.state === 'error' ? 'error' : 'closed'}`} />
                <div className="key-main">
                  <div className="key-name">
                    {tunnel.name}
                    <span className="key-type">{tunnel.type}</span>
                    {running && status.connections > 0 && (
                      <span className="key-badge conn">{status.connections} conn</span>
                    )}
                  </div>
                  <div className="key-fp">{status.error ?? describe(tunnel)}</div>
                </div>
                <button className="btn ghost" onClick={() => setDraft(tunnel)}>
                  Edit
                </button>
                <button className="btn" onClick={() => void toggle(tunnel)}>
                  {running || status.state === 'starting' ? 'Stop' : 'Start'}
                </button>
                <button
                  className="btn ghost danger"
                  onClick={() => remove(tunnel)}
                  disabled={dialogBusy}
                >
                  Delete
                </button>
              </div>
            )
          })}
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            disabled={!sshSessions.length}
            onClick={() => setDraft(BLANK(sshSessions[0]?.id ?? ''))}
          >
            New tunnel…
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
