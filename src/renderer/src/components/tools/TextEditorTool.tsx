import { useState } from 'react'

/** MobaTextEditor, for local files. Remote files use the SFTP browser's editor. */
export function TextEditorTool() {
  const [path, setPath] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const dirty = text !== original

  const open = async () => {
    const chosen = await window.api.toolbox.pickFile('Open a file')
    if (!chosen) return
    try {
      const contents = await window.api.toolbox.readFile(chosen)
      setPath(chosen)
      setText(contents)
      setOriginal(contents)
      setError(null)
      setStatus(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async (saveAs = false) => {
    let target = path
    if (saveAs || !target) {
      target = await window.api.toolbox.saveFile(path ?? 'untitled.txt')
      if (!target) return
    }
    try {
      await window.api.toolbox.writeFile(target, text)
      setPath(target)
      setOriginal(text)
      setStatus(`Saved ${target}`)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {error && <div className="warning">{error}</div>}
      {status && <div className="notice">{status}</div>}

      <div className="preset-row">
        <button className="btn" onClick={() => void open()}>
          Open…
        </button>
        <button className="btn" disabled={!dirty} onClick={() => void save(false)}>
          Save
        </button>
        <button className="btn ghost" onClick={() => void save(true)}>
          Save as…
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setPath(null)
            setText('')
            setOriginal('')
            setStatus(null)
          }}
        >
          New
        </button>
      </div>

      <div className="editor-path">
        {path ?? 'Untitled'}
        {dirty && ' — unsaved'}
      </div>

      <textarea
        className="editor-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.metaKey && e.key === 's') {
            e.preventDefault()
            void save(false)
          }
        }}
      />
    </>
  )
}
