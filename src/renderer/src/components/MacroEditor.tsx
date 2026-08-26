import { useState } from 'react'
import { MACRO_SPEEDS, type Macro, type MacroStep } from '@shared/types'
import { decodeData, encodeData, macroSpeed } from '../macro-recorder'

interface Props {
  macro: Macro
  onSave: (macro: Macro) => void
  onCancel: () => void
}

/** A step as shown in the table: bytes escaped so they can be typed. */
interface DraftStep {
  delay: string
  text: string
}

export function MacroEditor({ macro, onSave, onCancel }: Props) {
  const [name, setName] = useState(macro.name)
  const [speed, setSpeed] = useState(macroSpeed(macro))
  const [steps, setSteps] = useState<DraftStep[]>(
    macro.steps.map((s) => ({ delay: String(s.delay), text: encodeData(s.data) }))
  )
  const [error, setError] = useState<string | null>(null)

  const update = (index: number, patch: Partial<DraftStep>) =>
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const removeStep = (index: number) =>
    setSteps((current) => current.filter((_, i) => i !== index))

  const move = (index: number, by: number) =>
    setSteps((current) => {
      const next = [...current]
      const target = index + by
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const addStep = () => setSteps((current) => [...current, { delay: '100', text: '' }])

  /** Add a whole command plus its Enter, which is what most edits are. */
  const addCommand = () =>
    setSteps((current) => [
      ...current,
      { delay: '150', text: '' },
      { delay: '50', text: '\\r' }
    ])

  const save = () => {
    const parsed: MacroStep[] = []
    for (const [index, step] of steps.entries()) {
      const delay = Number(step.delay)
      if (!Number.isFinite(delay) || delay < 0) {
        setError(`Step ${index + 1} has an invalid delay.`)
        return
      }
      parsed.push({ data: decodeData(step.text), delay: Math.min(delay, 60_000) })
    }
    if (!name.trim()) {
      setError('Give the macro a name.')
      return
    }
    onSave({ ...macro, name: name.trim(), speed, steps: parsed })
  }

  const totalMs = steps.reduce((sum, s) => sum + (Number(s.delay) || 0), 0)
  const estimate = speed > 0 ? totalMs / speed : steps.length * 15

  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Edit macro</h2>

        {error && <div className="warning">{error}</div>}

        <div className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Default speed</label>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {MACRO_SPEEDS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="hint">
          Each step is sent as typed. Control characters use backslash escapes:{' '}
          <code>\r</code> Enter, <code>\t</code> Tab, <code>\e</code> Escape,{' '}
          <code>\x03</code> Ctrl-C. Delay is the pause <em>before</em> that step, in
          milliseconds. Estimated run time: {(estimate / 1000).toFixed(1)}s.
        </p>

        <div className="step-table">
          <div className="step-head">
            <span className="step-num">#</span>
            <span className="step-delay-h">Delay</span>
            <span>Sends</span>
          </div>

          {!steps.length && <div className="muted-row">No steps. Add one below.</div>}

          {steps.map((step, index) => (
            <div key={index} className="step-row">
              <span className="step-num">{index + 1}</span>
              <input
                className="step-delay"
                type="number"
                min={0}
                value={step.delay}
                onChange={(e) => update(index, { delay: e.target.value })}
                title="Milliseconds to wait before this step"
              />
              <input
                className="step-data mono"
                value={step.text}
                onChange={(e) => update(index, { text: e.target.value })}
                spellCheck={false}
                placeholder="text to send"
              />
              <button className="icon-btn" onClick={() => move(index, -1)} title="Move up">
                ↑
              </button>
              <button className="icon-btn" onClick={() => move(index, 1)} title="Move down">
                ↓
              </button>
              <button
                className="icon-btn danger"
                onClick={() => removeStep(index)}
                title="Delete step"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="preset-row" style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={addCommand}>
            + Command line
          </button>
          <button className="btn ghost" onClick={addStep}>
            + Single step
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
