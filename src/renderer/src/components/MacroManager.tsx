import { useCallback, useEffect, useRef, useState } from 'react'
import { MACRO_SPEEDS, type Macro, type MacroRunTarget } from '@shared/types'
import { describeSteps, macroSpeed, playMacroOnTargets, startRecording } from '../macro-recorder'
import { MacroEditor } from './MacroEditor'
import { usePrompt } from './InputDialog'

interface Props {
  /** Every open terminal, so a macro can be run against several at once. */
  targets: MacroRunTarget[]
  activeTabId: string | null
  onClose: () => void
}

interface RunState {
  macro: Macro
  speed: number
  selected: Set<string>
  running: boolean
  results: { tabId: string; error?: string }[] | null
}

export function MacroManager({ targets, activeTabId, onClose }: Props) {
  const [macros, setMacros] = useState<Macro[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Macro | null>(null)
  const [run, setRun] = useState<RunState | null>(null)
  const { dialog } = usePrompt()

  // Set when the user stops a run part-way through.
  const stopRef = useRef(false)

  const reload = useCallback(async () => {
    setMacros(await window.api.macros.list())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const beginRecording = () => {
    if (!activeTabId) {
      setError('Open a terminal tab first — a macro records what you type into one.')
      return
    }
    setError(null)
    startRecording(activeTabId)
    // This panel is modal, and its scrim covers the terminal. Close it so the
    // floating recording bar takes over and you can actually type.
    onClose()
  }

  const openRun = (macro: Macro) => {
    if (!targets.length) {
      setError('Open a terminal tab to play a macro into.')
      return
    }
    setError(null)
    setRun({
      macro,
      speed: macroSpeed(macro),
      // Default to the focused terminal; tick more to fan out.
      selected: new Set(activeTabId ? [activeTabId] : [targets[0].tabId]),
      running: false,
      results: null
    })
  }

  const toggleTarget = (tabId: string) =>
    setRun((current) => {
      if (!current) return current
      const selected = new Set(current.selected)
      if (selected.has(tabId)) selected.delete(tabId)
      else selected.add(tabId)
      return { ...current, selected }
    })

  const start = async () => {
    if (!run || !run.selected.size) return
    stopRef.current = false
    setRun({ ...run, running: true, results: null })
    try {
      const results = await playMacroOnTargets(
        [...run.selected],
        run.macro.steps,
        run.speed,
        () => stopRef.current
      )
      setRun((current) => (current ? { ...current, running: false, results } : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRun((current) => (current ? { ...current, running: false } : current))
    }
  }

  const saveEdit = async (macro: Macro) => {
    await window.api.macros.save(macro)
    setEditing(null)
    await reload()
  }

  const remove = async (macro: Macro) => {
    if (!window.confirm(`Delete macro "${macro.name}"?`)) return
    await window.api.macros.remove(macro.id)
    await reload()
  }

  const speedLabel = (macro: Macro) =>
    MACRO_SPEEDS.find((s) => s.value === macroSpeed(macro))?.label ?? 'As recorded'

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Macros</h2>

        {error && <div className="warning">{error}</div>}

        <p className="hint">
          {activeTabId
            ? 'Recording closes this panel so you can type; a floating bar appears with Stop and save.'
            : 'Open a terminal tab to record or play a macro.'}
        </p>

        {/* ---------- run panel ---------- */}
        {run && (
          <div className="inset">
            <div className="run-head">
              Run <strong>{run.macro.name}</strong> on{' '}
              {run.selected.size === 1 ? '1 terminal' : `${run.selected.size} terminals`}
            </div>

            <div className="field">
              <label>Terminals</label>
              <div className="target-list">
                {targets.map((target) => (
                  <label key={target.tabId} className="target-row">
                    <input
                      type="checkbox"
                      checked={run.selected.has(target.tabId)}
                      disabled={run.running}
                      onChange={() => toggleTarget(target.tabId)}
                    />
                    <span className="target-name">{target.title}</span>
                    {run.results?.find((r) => r.tabId === target.tabId) && (
                      <span
                        className={
                          run.results.find((r) => r.tabId === target.tabId)?.error
                            ? 'target-state bad'
                            : 'target-state good'
                        }
                      >
                        {run.results.find((r) => r.tabId === target.tabId)?.error ?? 'done'}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field" style={{ flex: 1 }}>
                <label>Speed for this run</label>
                <select
                  value={run.speed}
                  disabled={run.running}
                  onChange={(e) => setRun({ ...run, speed: Number(e.target.value) })}
                >
                  {MACRO_SPEEDS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, alignSelf: 'end' }}>
                <button
                  className="btn"
                  disabled={run.running}
                  onClick={() =>
                    setRun({ ...run, selected: new Set(targets.map((t) => t.tabId)) })
                  }
                >
                  Select all {targets.length}
                </button>
              </div>
            </div>

            {run.selected.size > 1 && (
              <p className="hint">
                Runs on all {run.selected.size} at once. They are separate shells, so a command
                that is safe on one is not automatically safe on the others.
              </p>
            )}

            <div className="modal-actions" style={{ marginTop: 4 }}>
              {run.running ? (
                <button
                  className="btn ghost danger"
                  style={{ marginRight: 'auto' }}
                  onClick={() => (stopRef.current = true)}
                >
                  Stop
                </button>
              ) : (
                <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setRun(null)}>
                  Cancel
                </button>
              )}
              <button
                className="btn primary"
                disabled={run.running || !run.selected.size}
                onClick={() => void start()}
              >
                {run.running ? 'Running…' : `Run on ${run.selected.size}`}
              </button>
            </div>
          </div>
        )}

        {/* ---------- macro list ---------- */}
        <div className="key-list">
          {!macros.length && <div className="muted-row">No macros saved yet.</div>}
          {macros.map((macro) => (
            <div key={macro.id} className="key-row">
              <div className="key-main">
                <div className="key-name">
                  {macro.name}
                  <span className="key-type">
                    {macro.steps.length} step{macro.steps.length === 1 ? '' : 's'}
                  </span>
                  <span className="key-badge">{speedLabel(macro)}</span>
                </div>
                <div className="key-fp">{describeSteps(macro.steps).slice(0, 120)}</div>
              </div>
              <button className="btn ghost" onClick={() => setEditing(macro)}>
                Edit
              </button>
              <button
                className="btn"
                disabled={!targets.length || Boolean(run?.running)}
                onClick={() => openRun(macro)}
              >
                Play…
              </button>
              <button className="btn ghost danger" onClick={() => void remove(macro)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            disabled={!activeTabId}
            onClick={beginRecording}
          >
            ● Record
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      {editing && (
        <MacroEditor
          macro={editing}
          onSave={(m) => void saveEdit(m)}
          onCancel={() => setEditing(null)}
        />
      )}
      {dialog}
    </div>
  )
}
