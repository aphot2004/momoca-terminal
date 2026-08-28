import { useEffect, useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import { useExclusive } from '../hooks/useExclusive'

interface Props {
  tabId: string
  path: string
  onClose: () => void
}

/**
 * MobaXterm's "open with embedded editor": pull the file over the existing SFTP
 * channel, edit, write it straight back.
 */
export function RemoteEditor({ tabId, path, onClose }: Props) {
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading')
  const [error, setError] = useState<string | null>(null)
  const { run: exclusive } = useExclusive()

  useEffect(() => {
    let cancelled = false
    void window.api.sftp
      .read(tabId, path)
      .then((contents) => {
        if (cancelled) return
        setText(contents)
        setOriginal(contents)
        setState('ready')
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setState('ready')
      })
    return () => {
      cancelled = true
    }
  }, [tabId, path])

  const dirty = text !== original && !error

  const save = async () => {
    setState('saving')
    try {
      await window.api.sftp.write(tabId, path, text)
      setOriginal(text)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setState('ready')
    }
  }

  // close() confirms before discarding, so Escape cannot lose an edit.
  useEscape(() => close())

  const close = () =>
    void exclusive(() => {
      if (dirty && !window.confirm('Discard unsaved changes?')) return
      onClose()
    })

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="modal editor" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          {path.split('/').pop()}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </h2>
        <div className="editor-path">{path}</div>

        {error && <div className="warning">{error}</div>}

        <textarea
          className="editor-area"
          value={state === 'loading' ? 'Loading…' : text}
          readOnly={state !== 'ready' || Boolean(error)}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.metaKey && e.key === 's') {
              e.preventDefault()
              if (dirty) void save()
            }
          }}
        />

        <div className="modal-actions">
          <span className="editor-hint">⌘S to save</span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={!dirty || state !== 'ready'}
            onClick={() => void save()}
          >
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
