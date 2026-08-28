import { useCallback, useEffect, useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import type { VaultStatus } from '@shared/types'

interface Props {
  /** 'unlock' asks for the existing password; 'settings' manages it. */
  intent: 'unlock' | 'settings'
  onClose: () => void
  onChanged?: (status: VaultStatus) => void
}

export function VaultDialog({ intent, onClose, onChanged }: Props) {
  // The unlock prompt is deliberately undismissable — it is the gate at
  // startup — so only the settings intent closes on Escape.
  useEscape(intent === 'settings' ? onClose : null)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'set' | 'remove'>('view')

  const refresh = useCallback(async () => {
    const next = await window.api.vault.status()
    setStatus(next)
    onChanged?.(next)
    return next
  }, [onChanged])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const unlock = async () => {
    setBusy(true)
    setError(null)
    try {
      // scrypt runs on the main thread; a wrong password costs the same as a right one.
      const ok = await window.api.vault.unlock(password)
      if (!ok) {
        setError('That password does not match.')
        return
      }
      setPassword('')
      await refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const applyMaster = async (next: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await window.api.vault.setMaster(next)
      setPassword('')
      setConfirm('')
      setMode('view')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // --- unlock ---------------------------------------------------------------

  if (intent === 'unlock') {
    return (
      <div className="scrim">
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          <h2>Unlock saved credentials</h2>
          <p className="hint">
            Enter your master password once for this session. Saved passwords and key passphrases
            stay locked until you do.
          </p>

          {error && <div className="warning">{error}</div>}

          <div className="field">
            <label>Master password</label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && !busy) void unlock()
              }}
            />
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Skip for now
            </button>
            <button className="btn primary" disabled={!password || busy} onClick={() => void unlock()}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- settings -------------------------------------------------------------

  const usingMaster = status?.mode === 'master'

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Credential vault</h2>

        {error && <div className="warning">{error}</div>}

        <dl className="props">
          <dt>Protection</dt>
          <dd>{usingMaster ? 'Master password' : 'macOS Keychain'}</dd>
          <dt>State</dt>
          <dd>{status?.locked ? 'Locked' : 'Unlocked'}</dd>
          <dt>Stored</dt>
          <dd>
            {status?.secretCount ?? 0} secret{status?.secretCount === 1 ? '' : 's'}
          </dd>
        </dl>

        {mode === 'view' && (
          <p className="hint" style={{ marginTop: 12 }}>
            {usingMaster
              ? 'You are asked for the master password once per app launch, then it is held in memory until you quit.'
              : 'Secrets are sealed with your macOS login Keychain — nothing to type, and protection is tied to your Mac account. Set a master password if you would rather gate them behind a passphrase you choose.'}
          </p>
        )}

        {mode === 'set' && (
          <div className="inset">
            <div className="field">
              <label>{usingMaster ? 'New master password' : 'Master password'}</label>
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Confirm</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {password && confirm && password !== confirm && (
              <p className="hint" style={{ color: 'var(--danger)' }}>
                Passwords do not match.
              </p>
            )}
            <p className="hint">
              There is no recovery. Forgetting it means re-entering every saved password by hand.
            </p>
            <div className="modal-actions" style={{ marginTop: 4 }}>
              <button className="btn" onClick={() => setMode('view')}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!password || password !== confirm || busy}
                onClick={() => void applyMaster(password)}
              >
                {busy ? 'Re-encrypting…' : 'Set master password'}
              </button>
            </div>
          </div>
        )}

        {mode === 'remove' && (
          <div className="inset">
            <p>
              Remove the master password and go back to the macOS Keychain? Your saved secrets are
              re-encrypted, not deleted.
            </p>
            <div className="modal-actions" style={{ marginTop: 4 }}>
              <button className="btn" onClick={() => setMode('view')}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void applyMaster(null)}>
                {busy ? 'Re-encrypting…' : 'Remove'}
              </button>
            </div>
          </div>
        )}

        {mode === 'view' && (
          <div className="modal-actions">
            {usingMaster && !status?.locked && (
              <button
                className="btn ghost"
                style={{ marginRight: 'auto' }}
                onClick={() => void window.api.vault.lock().then(refresh)}
              >
                Lock now
              </button>
            )}
            {usingMaster && (
              <button className="btn ghost danger" onClick={() => setMode('remove')}>
                Remove
              </button>
            )}
            <button className="btn" onClick={() => setMode('set')} disabled={status?.locked}>
              {usingMaster ? 'Change password…' : 'Set master password…'}
            </button>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
