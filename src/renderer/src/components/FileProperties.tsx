import { useState } from 'react'
import type { SftpEntry } from '@shared/types'

interface Props {
  tabId: string
  entry: SftpEntry
  onClose: () => void
  onChanged: () => void
}

/** Render the permission bits the way `ls -l` does. */
export function modeToRwx(mode: number): string {
  const bits = mode & 0o777
  const triplet = (value: number) =>
    `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`
  return `${triplet((bits >> 6) & 7)}${triplet((bits >> 3) & 7)}${triplet(bits & 7)}`
}

const CLASSES = ['Owner', 'Group', 'Others'] as const
const PERMS = [
  { label: 'r', bit: 4 },
  { label: 'w', bit: 2 },
  { label: 'x', bit: 1 }
] as const

export function FileProperties({ tabId, entry, onClose, onChanged }: Props) {
  const [mode, setMode] = useState(entry.mode & 0o777)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const toggle = (classIndex: number, bit: number) => {
    const shift = (2 - classIndex) * 3
    setMode((current) => current ^ (bit << shift))
  }

  const isSet = (classIndex: number, bit: number) => {
    const shift = (2 - classIndex) * 3
    return Boolean(mode & (bit << shift))
  }

  const apply = async () => {
    setSaving(true)
    try {
      await window.api.sftp.chmod(tabId, entry.path, mode)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const octal = mode.toString(8).padStart(3, '0')

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Properties</h2>

        {error && <div className="warning">{error}</div>}

        <dl className="props">
          <dt>Name</dt>
          <dd>{entry.name}</dd>
          <dt>Path</dt>
          <dd className="mono wrap">{entry.path}</dd>
          <dt>Type</dt>
          <dd>{entry.type}</dd>
          <dt>Size</dt>
          <dd>{entry.size.toLocaleString()} bytes</dd>
          <dt>Modified</dt>
          <dd>{entry.modified ? new Date(entry.modified).toLocaleString() : 'unknown'}</dd>
        </dl>

        <div className="field" style={{ marginTop: 12 }}>
          <label>
            Permissions — {modeToRwx(mode)} ({octal})
          </label>
          <table className="perm-grid">
            <thead>
              <tr>
                <th />
                {PERMS.map((p) => (
                  <th key={p.label}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((label, classIndex) => (
                <tr key={label}>
                  <td>{label}</td>
                  {PERMS.map((p) => (
                    <td key={p.label}>
                      <input
                        type="checkbox"
                        checked={isSet(classIndex, p.bit)}
                        onChange={() => toggle(classIndex, p.bit)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={saving || mode === (entry.mode & 0o777)}
            onClick={() => void apply()}
          >
            {saving ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
