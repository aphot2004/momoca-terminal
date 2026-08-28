import { useCallback, useEffect, useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import type { ImportedKey } from '@shared/types'
import { useExclusive } from '../hooks/useExclusive'

interface Props {
  onClose: () => void
  onChanged: () => void
}

/** Import state: a key file whose passphrase we still need before it can be parsed. */
interface PendingImport {
  path?: string
  text?: string
  name: string
}

export function KeyManager({ onClose, onChanged }: Props) {
  useEscape(onClose)
  const [keys, setKeys] = useState<ImportedKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [pending, setPending] = useState<PendingImport | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [remember, setRemember] = useState(true)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteName, setPasteName] = useState('')
  const { busy: dialogBusy, run: exclusive } = useExclusive()

  const reload = useCallback(async () => {
    setKeys(await window.api.keys.list())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const finishImport = useCallback(
    async (input: { path?: string; text?: string; name: string; passphrase?: string }) => {
      setError(null)
      const result = await window.api.keys.import({
        ...input,
        rememberPassphrase: remember
      })

      if (result.status === 'needs-passphrase') {
        setPending({ path: input.path, text: input.text, name: input.name })
        return
      }
      if (result.status === 'error') {
        setError(result.message)
        return
      }

      setPending(null)
      setPassphrase('')
      setPasting(false)
      setPasteText('')
      setPasteName('')
      setNotice(`Imported ${result.key.name} (${result.key.type})`)
      await reload()
      onChanged()
    },
    [onChanged, reload, remember]
  )

  const importFromFile = () =>
    void exclusive(async () => {
      const path = await window.api.keys.pickFile()
      if (!path) return
      await finishImport({ path, name: path.split('/').pop() ?? 'key' })
    })

  const remove = (key: ImportedKey) =>
    void exclusive(async () => {
      if (!window.confirm(`Delete "${key.name}"? Sessions using it will stop connecting.`)) return
      await window.api.keys.remove(key.id)
      await reload()
      onChanged()
    })

  const copyPublic = async (key: ImportedKey) => {
    await navigator.clipboard.writeText(key.publicKey)
    setNotice('Public key copied — add it to the server’s ~/.ssh/authorized_keys')
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>SSH keys</h2>

        {error && <div className="warning">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        {/* Passphrase step: shown only once the key turns out to be encrypted. */}
        {pending && (
          <div className="inset">
            <div className="field">
              <label>“{pending.name}” is encrypted — enter its passphrase</label>
              <input
                autoFocus
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && passphrase) {
                    void finishImport({ ...pending, passphrase })
                  }
                }}
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember it in the macOS Keychain
            </label>
            <div className="modal-actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!passphrase}
                onClick={() => void finishImport({ ...pending, passphrase })}
              >
                Unlock and import
              </button>
            </div>
          </div>
        )}

        {pasting && !pending && (
          <div className="inset">
            <div className="field">
              <label>Name</label>
              <input
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="work-laptop"
              />
            </div>
            <div className="field">
              <label>Private key (OpenSSH or PEM)</label>
              <textarea
                rows={7}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                spellCheck={false}
              />
            </div>
            <div className="modal-actions" style={{ marginTop: 4 }}>
              <button className="btn" onClick={() => setPasting(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!pasteText.trim()}
                onClick={() =>
                  void finishImport({ text: pasteText, name: pasteName || 'pasted key' })
                }
              >
                Import
              </button>
            </div>
          </div>
        )}

        <div className="key-list">
          {!keys.length && <div className="muted-row">No keys imported yet.</div>}
          {keys.map((key) => (
            <div key={key.id} className="key-row">
              <div className="key-main">
                <div className="key-name">
                  {key.name}
                  <span className="key-type">{key.type}</span>
                  {key.encrypted && <span className="key-badge">encrypted</span>}
                </div>
                <div className="key-fp">{key.fingerprint}</div>
              </div>
              <button className="btn ghost" onClick={() => void copyPublic(key)} title="Copy public key">
                Copy pub
              </button>
              <button
                className="btn ghost danger"
                onClick={() => remove(key)}
                title="Delete key"
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              setPasting((v) => !v)
              setPending(null)
            }}
          >
            Paste key…
          </button>
          <button className="btn" onClick={importFromFile} disabled={dialogBusy}>
            Import from file…
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
