import { useState } from 'react'

/** MobaDiff: a unified diff of two local files, via the system `diff`. */
export function DiffTool() {
  const [left, setLeft] = useState<string | null>(null)
  const [right, setRight] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const compare = async () => {
    if (!left || !right) return
    setBusy(true)
    setError(null)
    try {
      setDiff(await window.api.toolbox.diff(left, right))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDiff(null)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (side: 'left' | 'right') => {
    const chosen = await window.api.toolbox.pickFile(`Choose the ${side} file`)
    if (!chosen) return
    if (side === 'left') setLeft(chosen)
    else setRight(chosen)
    setDiff(null)
  }

  return (
    <>
      {error && <div className="warning">{error}</div>}

      <div className="field">
        <label>Original</label>
        <div className="field-row">
          <input value={left ?? ''} readOnly placeholder="Choose a file…" />
          <button className="btn" onClick={() => void pick('left')}>
            Browse…
          </button>
        </div>
      </div>

      <div className="field">
        <label>Changed</label>
        <div className="field-row">
          <input value={right ?? ''} readOnly placeholder="Choose a file…" />
          <button className="btn" onClick={() => void pick('right')}>
            Browse…
          </button>
        </div>
      </div>

      <button className="btn primary" disabled={!left || !right || busy} onClick={() => void compare()}>
        {busy ? 'Comparing…' : 'Compare'}
      </button>

      {diff !== null && (
        <pre className="diff-out">
          {diff.split('\n').map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith('+') && !line.startsWith('+++')
                  ? 'diff-add'
                  : line.startsWith('-') && !line.startsWith('---')
                    ? 'diff-del'
                    : line.startsWith('@@')
                      ? 'diff-hunk'
                      : undefined
              }
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      )}
    </>
  )
}
