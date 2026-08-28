import { useCallback, useEffect, useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import type { ToolCheck, ToolId } from '@shared/types'

interface Props {
  /** Scroll to and expand this tool when opened from a failed launch. */
  focus?: ToolId
  onClose: () => void
}

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="cmd-row">
      <code>{command}</code>
      <button
        className="btn ghost"
        onClick={() => {
          void navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * Which session types work out of the box, which need something installed, and
 * exactly how to install it. Opened from the ribbon, or automatically when a
 * session can't launch for want of a dependency.
 */
export function ToolGuide({ focus, onClose }: Props) {
  useEscape(onClose)
  const [tools, setTools] = useState<ToolCheck[]>([])
  const [open, setOpen] = useState<ToolId | null>(focus ?? null)
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setTools(await window.api.tools.check())
    setBusy(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const missing = tools.filter((t) => !t.available)

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Session requirements</h2>

        <p className="hint">
          SSH, SFTP, Telnet, Serial, Shell, VNC and Browser sessions work with no extra software.
          The rest need a client installed — here&rsquo;s what&rsquo;s missing and how to get it.
        </p>

        {!busy && !missing.length && (
          <div className="notice">Everything is installed — all session types are available.</div>
        )}

        <div className="key-list">
          {busy && <div className="muted-row">Checking your system…</div>}

          {tools.map((tool) => {
            const expanded = open === tool.id
            return (
              <div key={tool.id} className="tool-row">
                <button
                  className="tool-head"
                  onClick={() => setOpen(expanded ? null : tool.id)}
                  disabled={tool.available && !tool.install}
                >
                  <span className={`status-dot ${tool.available ? 'ready' : 'error'}`} />
                  <span className="tool-name">{tool.name}</span>
                  <span className="tool-purpose">{tool.purpose}</span>
                  <span className={`tool-state${tool.available ? ' ok' : ''}`}>
                    {tool.available ? 'Installed' : 'Missing'}
                  </span>
                </button>

                {tool.detail && expanded && <div className="tool-detail">{tool.detail}</div>}

                {expanded && tool.install && (
                  <div className="tool-body">
                    <p>{tool.install.summary}</p>
                    <ol>
                      {tool.install.steps.map((step, index) => (
                        <li key={index}>
                          {step.label}
                          {step.command && <CommandLine command={step.command} />}
                        </li>
                      ))}
                    </ol>
                    {tool.install.url && (
                      <a href={tool.install.url} target="_blank" rel="noreferrer">
                        {tool.install.url}
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="hint" style={{ marginTop: 12 }}>
          Don&rsquo;t have Homebrew? Install it first from{' '}
          <a href="https://brew.sh" target="_blank" rel="noreferrer">
            brew.sh
          </a>
          , then re-run the commands above.
        </p>

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
