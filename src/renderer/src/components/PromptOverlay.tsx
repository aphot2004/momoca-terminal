import { useEffect, useState } from 'react'

export interface SecretRequest {
  type: 'secret'
  requestId: string
  title: string
  kind: 'password' | 'passphrase' | 'keyboard-interactive'
  prompts: { prompt: string; echo: boolean }[]
}

export interface HostKeyRequest {
  type: 'hostkey'
  requestId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  mismatch: boolean
}

export type PromptRequest = SecretRequest | HostKeyRequest

/**
 * Auth and host-key modals. These are driven by the main process mid-connect,
 * so the answer always travels back through `prompts.respond`.
 */
export function PromptOverlay({ request, onDone }: { request: PromptRequest; onDone: () => void }) {
  const [answers, setAnswers] = useState<string[]>([])

  useEffect(() => {
    setAnswers(request.type === 'secret' ? request.prompts.map(() => '') : [])
  }, [request])

  const respond = (value: unknown) => {
    window.api.prompts.respond(request.requestId, value)
    onDone()
  }

  if (request.type === 'hostkey') {
    return (
      <div className="scrim">
        <div className="modal">
          <h2>{request.mismatch ? 'Host key changed' : 'Unknown host'}</h2>

          {request.mismatch && (
            <div className="warning">
              The key for this host does not match the one stored in known_hosts. This is what a
              man-in-the-middle attack looks like. Only continue if you know the server was
              rebuilt or rekeyed.
            </div>
          )}

          <p style={{ margin: '0 0 4px', color: 'var(--text-dim)' }}>
            {request.host}:{request.port} presented a {request.keyType} key:
          </p>
          <div className="fingerprint">{request.fingerprint}</div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)' }}>
            {request.mismatch
              ? 'Accepting connects this once without updating known_hosts.'
              : 'Accepting adds it to ~/.ssh/known_hosts.'}
          </p>

          <div className="modal-actions">
            <button className="btn" onClick={() => respond(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              style={request.mismatch ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
              onClick={() => respond(true)}
            >
              {request.mismatch ? 'Connect anyway' : 'Trust and connect'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="scrim">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          respond(answers)
        }}
      >
        <h2>{request.title}</h2>
        {request.prompts.map((prompt, index) => (
          <div className="field" key={index}>
            <label>{prompt.prompt}</label>
            <input
              autoFocus={index === 0}
              type={prompt.echo ? 'text' : 'password'}
              value={answers[index] ?? ''}
              onChange={(e) =>
                setAnswers((current) => {
                  const next = [...current]
                  next[index] = e.target.value
                  return next
                })
              }
            />
          </div>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => respond(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Continue
          </button>
        </div>
      </form>
    </div>
  )
}
