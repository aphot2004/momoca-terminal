import { describeSteps, discardRecording, stopRecording, useRecorder } from '../macro-recorder'
import { usePrompt } from './InputDialog'

interface Props {
  /** Called after a macro is saved, so the manager can reopen showing it. */
  onSaved: () => void
}

/**
 * Floating controls shown while a macro is recording.
 *
 * This exists because the macro panel is a modal, and a modal's scrim covers
 * the terminal — you cannot type into the thing being recorded while it is
 * open. So Record closes the panel and leaves this bar behind: it floats above
 * the terminal, takes pointer events only on itself, and never blocks typing.
 */
export function RecordingBar({ onSaved }: Props) {
  const recorder = useRecorder()
  const { ask, dialog } = usePrompt()

  if (!recorder.recording) return dialog ? <>{dialog}</> : null

  const save = async () => {
    const steps = stopRecording()
    if (!steps.length) return

    const name = await ask({
      title: 'Save macro',
      label: `${steps.length} step${steps.length === 1 ? '' : 's'} recorded`,
      placeholder: 'deploy-restart',
      confirmLabel: 'Save'
    })
    if (!name) return

    await window.api.macros.save({ name, steps, createdAt: Date.now(), useRecordedTiming: false })
    onSaved()
  }

  const preview = describeSteps(recorder.steps)

  return (
    <>
      <div className="recording-bar" role="status">
        <span className="rec-dot" />
        <span className="rec-count">
          Recording · {recorder.steps.length} step{recorder.steps.length === 1 ? '' : 's'}
        </span>
        <span className="rec-preview mono" title={preview}>
          {preview.slice(-48) || 'type in the terminal…'}
        </span>
        <button className="btn ghost" onClick={() => discardRecording()}>
          Discard
        </button>
        <button className="btn primary" disabled={!recorder.steps.length} onClick={() => void save()}>
          Stop and save
        </button>
      </div>
      {dialog}
    </>
  )
}
