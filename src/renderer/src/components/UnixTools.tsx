import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UnixTool, UnixToolGroup } from '@shared/types'

interface Props {
  onClose: () => void
  /** Paste a command into the focused terminal, when there is one. */
  onRun: ((command: string) => void) | null
}

const GROUPS: { id: UnixToolGroup; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'text', label: 'Text' },
  { id: 'network', label: 'Network' },
  { id: 'system', label: 'System' },
  { id: 'archives', label: 'Archives' },
  { id: 'gnu', label: 'GNU variants' }
]

export function UnixTools({ onClose, onRun }: Props) {
  const [tools, setTools] = useState<UnixTool[] | null>(null)
  const [group, setGroup] = useState<UnixToolGroup>('files')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setTools(null)
    setTools(await window.api.unix.check())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const missing = useMemo(
    () => (tools ?? []).filter((t) => !t.available && t.formula),
    [tools]
  )

  /** One brew line that installs everything absent, rather than N separate ones. */
  const installAll = useMemo(() => {
    const formulae = [...new Set(missing.map((t) => t.formula!))].sort()
    return formulae.length ? `brew install ${formulae.join(' ')}` : null
  }, [missing])

  const shown = (tools ?? [])
    .filter((t) => t.group === group)
    .filter((t) => !onlyMissing || !t.available)

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400)
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Unix command set</h2>

        <p className="hint">
          Windows terminals bundle a Unix toolset because the platform has none. macOS already ships one, so
          there is nothing to bundle here — the real gaps on a Mac are that the built-in tools are
          the <strong>BSD</strong> variants, whose flags differ from the GNU ones most Linux
          documentation assumes, and that a handful of everyday utilities simply aren&rsquo;t
          present. This shows what you have, where BSD will surprise you, and how to get the rest.
        </p>

        {installAll && (
          <div className="inset">
            <div className="cmd-row">
              <code>{installAll}</code>
              <button className="btn ghost" onClick={() => copy(installAll, 'all')}>
                {copied === 'all' ? 'Copied' : 'Copy'}
              </button>
              {onRun && (
                <button className="btn" onClick={() => onRun(installAll)}>
                  Run
                </button>
              )}
            </div>
            <p className="hint" style={{ margin: '6px 0 0' }}>
              Installs the {missing.length} missing tool{missing.length === 1 ? '' : 's'} in one go.
            </p>
          </div>
        )}

        <div className="panel-tabs inline">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              className={`panel-tab${group === g.id ? ' active' : ''}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <label className="checkbox" style={{ margin: '8px 0' }}>
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          Only show what&rsquo;s missing
        </label>

        <div className="key-list">
          {!tools && <div className="muted-row">Checking your system…</div>}
          {tools && !shown.length && (
            <div className="muted-row">
              {onlyMissing ? 'Nothing missing in this group.' : 'No tools in this group.'}
            </div>
          )}

          {shown.map((tool) => (
            <div key={tool.name} className="key-row">
              <span className={`status-dot ${tool.available ? 'ready' : 'error'}`} />
              <div className="key-main">
                <div className="key-name">
                  <span className="mono">{tool.name}</span>
                  <span className="tool-purpose">{tool.purpose}</span>
                  {tool.bsdCaveat && <span className="key-badge">BSD</span>}
                </div>
                <div className="key-fp">
                  {tool.available
                    ? (tool.bsdCaveat ?? tool.version ?? tool.path)
                    : tool.formula
                      ? `Not installed — brew install ${tool.formula}`
                      : 'Not installed'}
                </div>
              </div>

              {tool.available ? (
                <button
                  className="btn ghost"
                  onClick={() => copy(tool.path ?? tool.name, tool.name)}
                  title={tool.path}
                >
                  {copied === tool.name ? 'Copied' : 'Path'}
                </button>
              ) : (
                tool.formula && (
                  <button
                    className="btn ghost"
                    onClick={() => copy(`brew install ${tool.formula}`, tool.name)}
                  >
                    {copied === tool.name ? 'Copied' : 'Copy'}
                  </button>
                )
              )}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" style={{ marginRight: 'auto' }} onClick={() => void refresh()}>
            Re-check
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
