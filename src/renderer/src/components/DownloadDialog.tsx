import { useState } from 'react'
import type { SftpEntry } from '@shared/types'
import { useEscape } from '../hooks/useEscape'

interface Props {
  /** What is about to come down: files, folders, or a mix of both. */
  entries: SftpEntry[]
  onCancel: () => void
  /** Hands back the pattern lines; the destination is picked next, natively. */
  onConfirm: (excludes: string[]) => void
}

const STORAGE_KEY = 'momoca.sftp.excludes'

/** The last pattern set used, so a habitual `node_modules` is typed once. */
export function loadExcludes(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistExcludes(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* a private window or a full disk is not worth failing the download over */
  }
}

/** Patterns people reach for often enough to be worth one click. */
const PRESETS = ['node_modules/', '.git/', '*.log', '.DS_Store', 'venv/', '__pycache__/']

/**
 * Confirms a recursive download and collects what to leave out.
 *
 * This sits in front of every download that walks a tree, for the same reason
 * a recursive delete is confirmed: it is the moment you can still say "not that
 * folder". Empty patterns are the common case, so Return goes straight through
 * to the destination picker.
 */
export function DownloadDialog({ entries, onCancel, onConfirm }: Props) {
  useEscape(onCancel)
  const [text, setText] = useState(loadExcludes)

  const folders = entries.filter((e) => e.type === 'directory').length
  const files = entries.length - folders
  const shape = [
    folders ? `${folders} folder${folders === 1 ? '' : 's'}` : '',
    files ? `${files} file${files === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' and ')

  const confirm = () => {
    persistExcludes(text)
    onConfirm(text.split('\n'))
  }

  const addPreset = (pattern: string) => {
    setText((current) => {
      const lines = current.split('\n').filter((line) => line.trim())
      if (lines.includes(pattern)) return current
      return [...lines, pattern].join('\n')
    })
  }

  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Download {shape}</h2>

        <div className="inset download-manifest">
          {entries.slice(0, 8).map((entry) => (
            <div key={entry.path} className="download-item">
              <span className="mono">{entry.name}</span>
              {entry.type === 'directory' && <span className="muted"> — and everything inside</span>}
            </div>
          ))}
          {entries.length > 8 && (
            <div className="download-item muted">…and {entries.length - 8} more</div>
          )}
        </div>

        <div className="field">
          <label htmlFor="sftp-excludes">Leave out — one pattern per line</label>
          <textarea
            id="sftp-excludes"
            className="mono"
            rows={5}
            value={text}
            spellCheck={false}
            placeholder={'node_modules/\n*.log'}
            onChange={(e) => setText(e.target.value)}
            // Return submits, as it would in a single-line field; a pattern
            // list is short enough that Shift+Return is the newline.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                confirm()
              }
            }}
          />
          <div className="hint">
            A name on its own (<code>node_modules</code>, <code>*.log</code>) matches at any
            depth. A trailing <code>/</code> matches folders only. A pattern containing{' '}
            <code>/</code> is anchored to the path the item will have on disk (
            <code>src/generated</code>). <code>*</code> stops at a slash, <code>**</code>{' '}
            crosses one. An excluded folder is never opened.
          </div>
        </div>

        <div className="field">
          <label>Common ones</label>
          <div className="preset-row">
            {PRESETS.map((pattern) => (
              <button key={pattern} className="btn ghost preset" onClick={() => addPreset(pattern)}>
                {pattern}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm}>
            Choose destination…
          </button>
        </div>
      </div>
    </div>
  )
}
