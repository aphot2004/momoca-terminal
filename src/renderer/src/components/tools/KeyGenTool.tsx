import { useState } from 'react'

interface Props {
  onImported: () => void
}

const TYPES = [
  { value: 'ed25519', label: 'Ed25519 — recommended', bits: null },
  { value: 'rsa', label: 'RSA', bits: [4096, 3072, 2048] },
  { value: 'ecdsa', label: 'ECDSA', bits: [521, 384, 256] }
] as const

/** MobaKeyGen's job: make a keypair, then put it straight in the key store. */
export function KeyGenTool({ onImported }: Props) {
  const [type, setType] = useState<'ed25519' | 'rsa' | 'ecdsa'>('ed25519')
  const [bits, setBits] = useState(4096)
  const [comment, setComment] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ publicKey: string; fingerprint: string } | null>(null)

  const bitOptions = TYPES.find((t) => t.value === type)?.bits

  const generate = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const key = await window.api.toolbox.genKey({
        type,
        bits: bitOptions ? bits : undefined,
        comment: comment.trim() || undefined,
        passphrase: passphrase || undefined
      })

      // Hand the private key straight to the store; it is never shown, and the
      // temp copy on disk is deleted by the generator.
      const imported = await window.api.keys.import({
        text: key.privateKey,
        name: name.trim() || comment.trim() || `${type} key`,
        passphrase: passphrase || undefined,
        rememberPassphrase: true
      })

      if (imported.status !== 'ok') {
        setError(imported.status === 'error' ? imported.message : 'Could not import the new key')
        return
      }

      setResult({ publicKey: key.publicKey, fingerprint: key.fingerprint })
      setPassphrase('')
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <div className="warning">{error}</div>}

      {result && (
        <div className="notice">
          Key generated and added to your keys. Fingerprint {result.fingerprint}
        </div>
      )}

      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {bitOptions && (
          <div className="field" style={{ width: 110 }}>
            <label>Size</label>
            <select value={bits} onChange={(e) => setBits(Number(e.target.value))}>
              {bitOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Name in your key list</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="work-laptop" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Comment</label>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="you@mac"
          />
        </div>
      </div>

      <div className="field">
        <label>Passphrase — optional, sealed in the Keychain if set</label>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </div>

      <button className="btn primary" disabled={busy} onClick={() => void generate()}>
        {busy ? 'Generating…' : 'Generate and import'}
      </button>

      {result && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>Public key — paste into the server&rsquo;s ~/.ssh/authorized_keys</label>
          <div className="cmd-row">
            <code>{result.publicKey}</code>
            <button
              className="btn ghost"
              onClick={() => void navigator.clipboard.writeText(result.publicKey)}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </>
  )
}
