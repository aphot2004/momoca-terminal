import { useEffect, useState } from 'react'
import { KIND_REQUIREMENT, type SessionKind, type ToolCheck } from '@shared/types'

interface Props {
  value: SessionKind
  onChange: (kind: SessionKind) => void
  /** Opens the requirements guide, focused on a tool when one is named. */
  onOpenGuide: (focus?: ToolCheck['id']) => void
}

interface TypeDef {
  kind: SessionKind
  label: string
  glyph: string
  color: string
  note: string
}

const TYPES: TypeDef[] = [
  { kind: 'ssh', label: 'SSH', glyph: '⇄', color: '#4c7ce0', note: 'Shell + SFTP in a tab' },
  { kind: 'telnet', label: 'Telnet', glyph: '⌁', color: '#5aa9e0', note: 'Unencrypted terminal' },
  { kind: 'rsh', label: 'Rsh', glyph: '⇉', color: '#9a8fb0', note: 'Legacy remote shell' },
  { kind: 'xdmcp', label: 'Xdmcp', glyph: '✳', color: '#c98fe0', note: 'Remote X desktop' },
  { kind: 'rdp', label: 'RDP', glyph: '🖵', color: '#e07a5f', note: 'Windows remote desktop' },
  { kind: 'vnc', label: 'VNC', glyph: '▦', color: '#e0a83c', note: 'Screen sharing' },
  { kind: 'ftp', label: 'FTP', glyph: '⇅', color: '#8fbf7a', note: 'Plain file transfer' },
  { kind: 'sftp', label: 'SFTP', glyph: '🗀', color: '#e0a83c', note: 'File browser only' },
  { kind: 'serial', label: 'Serial', glyph: '⚟', color: '#6fd0c0', note: 'Serial console' },
  { kind: 'local', label: 'Shell', glyph: '›_', color: '#9ece6a', note: 'Local login shell' },
  { kind: 'browser', label: 'Browser', glyph: '◍', color: '#7dcfff', note: 'Opens your browser' },
  { kind: 'mosh', label: 'Mosh', glyph: '≈', color: '#bb9af7', note: 'Roaming SSH' }
]

/**
 * MobaXterm's session-type strip. A type whose external client isn't installed
 * is disabled rather than allowed to fail at connect time — the row underneath
 * names what's missing and links to the guide that explains how to install it.
 */
export function SessionTypePicker({ value, onChange, onOpenGuide }: Props) {
  const [tools, setTools] = useState<ToolCheck[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.tools
      .check()
      .then((checked) => {
        if (!cancelled) setTools(checked)
      })
      .catch(() => {
        // If detection fails, leave everything enabled rather than locking the
        // user out of session types that may well work.
        if (!cancelled) setTools([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toolFor = (kind: SessionKind) => {
    const id = KIND_REQUIREMENT[kind]
    if (!id || !tools) return null
    return tools.find((t) => t.id === id) ?? null
  }

  // Unknown (still loading, or detection failed) counts as available.
  const isAvailable = (kind: SessionKind) => toolFor(kind)?.available !== false

  const missing = TYPES.filter((t) => !isAvailable(t.kind))

  return (
    <>
      <div className="type-picker">
        {TYPES.map((type) => {
          const tool = toolFor(type.kind)
          const available = tool?.available !== false
          const selected = type.kind === value

          return (
            <button
              key={type.kind}
              type="button"
              className={`type-tile${selected ? ' selected' : ''}${available ? '' : ' disabled'}`}
              // A selected-but-unavailable type stays visible when editing an
              // existing session; it just can't be chosen afresh.
              disabled={!available && !selected}
              title={
                available
                  ? `${type.label} — ${type.note}`
                  : `${type.label} needs ${tool?.name} — not installed`
              }
              onClick={() => available && onChange(type.kind)}
            >
              <span className="type-glyph" style={{ color: type.color }}>
                {type.glyph}
              </span>
              <span className="type-label">{type.label}</span>
              {!available && <span className="type-missing" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      {missing.length > 0 && (
        <p className="hint picker-missing">
          {missing.map((t) => t.label).join(', ')}{' '}
          {missing.length === 1 ? 'needs' : 'need'} software you don&rsquo;t have.{' '}
          <button
            type="button"
            className="linklike"
            onClick={() => onOpenGuide(toolFor(missing[0].kind)?.id)}
          >
            How to install
          </button>
        </p>
      )}

      {!isAvailable(value) && (
        <div className="warning">
          This session type can&rsquo;t launch until its client is installed. You can still save it.
        </div>
      )}
    </>
  )
}
