import { useCallback, useState, type ReactNode } from 'react'
import { useEscape } from './../hooks/useEscape'

interface Request {
  title: string
  label: string
  initial: string
  confirmLabel: string
  placeholder?: string
  resolve: (value: string | null) => void
}

export interface AskOptions {
  title: string
  label: string
  initial?: string
  confirmLabel?: string
  placeholder?: string
}

/**
 * A replacement for `window.prompt`, which Electron does not implement — it
 * throws "prompt() is not supported", so anything relying on it fails silently.
 *
 * Returns an `ask` that resolves like `prompt` did, plus the element to render.
 */
export function usePrompt(): {
  ask: (options: AskOptions) => Promise<string | null>
  dialog: ReactNode
} {
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')

  const ask = useCallback(
    (options: AskOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.initial ?? '')
        setRequest({
          title: options.title,
          label: options.label,
          initial: options.initial ?? '',
          confirmLabel: options.confirmLabel ?? 'OK',
          placeholder: options.placeholder,
          resolve
        })
      }),
    []
  )

  const settle = useCallback(
    (result: string | null) => {
      request?.resolve(result)
      setRequest(null)
      setValue('')
    },
    [request]
  )

  // Was handled on the input's own keydown, so Escape did nothing whenever
  // focus sat anywhere else in the dialog.
  useEscape(request ? () => settle(null) : null)

  const dialog = request ? (
    <div className="scrim" onMouseDown={() => settle(null)}>
      <div className="modal narrow" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{request.title}</h2>
        <div className="field">
          <label>{request.label}</label>
          <input
            autoFocus
            value={value}
            placeholder={request.placeholder}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) settle(value.trim())
            }}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => settle(null)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!value.trim()}
            onClick={() => settle(value.trim())}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { ask, dialog }
}
