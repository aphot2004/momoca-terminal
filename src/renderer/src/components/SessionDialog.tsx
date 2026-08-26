import { useEffect, useState } from 'react'
import type { AuthMethod, ImportedKey, SavedSession, SessionKind, ToolId } from '@shared/types'
import { useExclusive } from '../hooks/useExclusive'
import { SessionTypePicker } from './SessionTypePicker'

interface Props {
  initial: SavedSession | null
  onSave: (session: SavedSession, savePassword?: string) => void
  onDelete: (id: string) => void
  onCancel: () => void
  onManageKeys: () => void
  onOpenGuide: (focus?: ToolId) => void
}

const BLANK: SavedSession = {
  id: '',
  name: '',
  kind: 'ssh',
  folder: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'agent',
  trackCwd: true
}

const DEFAULT_PORT: Partial<Record<SessionKind, number>> = {
  ssh: 22,
  sftp: 22,
  mosh: 22,
  telnet: 23,
  ftp: 21,
  rsh: 514,
  rdp: 3389,
  vnc: 5900,
  browser: 80,
  xdmcp: 177
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

/** Which fields each protocol needs. */
const NEEDS_HOST: SessionKind[] = [
  'ssh',
  'sftp',
  'telnet',
  'mosh',
  'ftp',
  'rsh',
  'rdp',
  'vnc',
  'browser',
  'xdmcp'
]
const NEEDS_USER: SessionKind[] = ['ssh', 'sftp', 'mosh', 'rsh']
const SHOWS_USER: SessionKind[] = [...NEEDS_USER, 'ftp', 'rdp', 'vnc']
const NEEDS_AUTH: SessionKind[] = ['ssh', 'sftp']

/** Explains where a session will actually appear, when it isn't a tab. */
const KIND_NOTE: Partial<Record<SessionKind, string>> = {
  vnc: 'Opens in macOS Screen Sharing — no extra software needed.',
  browser: 'Opens the host in your default browser.',
  rdp: 'Opens in FreeRDP or Windows App, whichever is installed.',
  xdmcp: 'Starts an X server on display :1 via XQuartz and queries the host.',
  ftp: 'Runs the ftp client in a tab. FTP sends credentials in the clear — prefer SFTP.',
  rsh: 'Runs the rsh client in a tab. Unencrypted — only on a trusted network.',
  mosh: 'Runs the mosh client in a tab. Needs mosh on this Mac and on the server.'
}

export function SessionDialog({
  initial,
  onSave,
  onDelete,
  onCancel,
  onManageKeys,
  onOpenGuide
}: Props) {
  const [draft, setDraft] = useState<SavedSession>(initial ?? BLANK)
  const [password, setPassword] = useState('')
  const [keys, setKeys] = useState<ImportedKey[]>([])
  const [ports, setPorts] = useState<{ path: string; label: string }[]>([])
  const { busy: pickerBusy, run: exclusive } = useExclusive()

  useEffect(() => {
    void window.api.keys.list().then(setKeys)
  }, [])

  useEffect(() => {
    if (draft.kind === 'serial') void window.api.serial.list().then(setPorts).catch(() => setPorts([]))
  }, [draft.kind])

  const set = <K extends keyof SavedSession>(key: K, value: SavedSession[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const changeKind = (kind: SessionKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      // Snap the port to the new protocol's default unless it was customised.
      port:
        current.port && current.port !== DEFAULT_PORT[current.kind]
          ? current.port
          : DEFAULT_PORT[kind]
    }))

  const needsHost = NEEDS_HOST.includes(draft.kind)
  const needsUser = NEEDS_USER.includes(draft.kind)
  const showsUser = SHOWS_USER.includes(draft.kind)
  const needsAuth = NEEDS_AUTH.includes(draft.kind)

  const canSave =
    draft.name.trim() &&
    (!needsHost || draft.host?.trim()) &&
    (!needsUser || draft.username?.trim()) &&
    (draft.kind !== 'serial' || draft.serialPath)

  const pickExternalKey = () =>
    void exclusive(async () => {
      const path = await window.api.dialog.pickPrivateKey()
      if (path) {
        set('privateKeyPath', path)
        set('keyId', undefined)
      }
    })

  return (
    <div className="scrim" onMouseDown={onCancel}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{initial ? 'Edit session' : 'New session'}</h2>

        <SessionTypePicker value={draft.kind} onChange={changeKind} onOpenGuide={onOpenGuide} />

        <div className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Name</label>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="prod-web-01"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Folder</label>
            <input
              value={draft.folder}
              onChange={(e) => set('folder', e.target.value)}
              placeholder="User sessions"
            />
          </div>
        </div>

        {needsHost && (
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Host</label>
              <input value={draft.host ?? ''} onChange={(e) => set('host', e.target.value)} />
            </div>
            <div className="field" style={{ width: 92 }}>
              <label>{draft.kind === 'mosh' ? 'SSH port' : 'Port'}</label>
              <input
                type="number"
                value={draft.port ?? DEFAULT_PORT[draft.kind] ?? 22}
                onChange={(e) => set('port', Number(e.target.value) || undefined)}
              />
            </div>
          </div>
        )}

        {showsUser && (
          <div className="field">
            <label>Username{needsUser ? '' : ' (optional)'}</label>
            <input
              value={draft.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>
        )}

        {KIND_NOTE[draft.kind] && <p className="hint">{KIND_NOTE[draft.kind]}</p>}

        {draft.kind === 'serial' && (
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Device</label>
              <select
                value={draft.serialPath ?? ''}
                onChange={(e) => set('serialPath', e.target.value)}
              >
                <option value="">
                  {ports.length ? '— select a device —' : 'No serial devices detected'}
                </option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} {port.label && `· ${port.label}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>Baud rate</label>
              <select
                value={draft.baudRate ?? 115200}
                onChange={(e) => set('baudRate', Number(e.target.value))}
              >
                {BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {draft.kind === 'local' && (
          <div className="field">
            <label>Shell</label>
            <input
              value={draft.shell ?? ''}
              onChange={(e) => set('shell', e.target.value)}
              placeholder="Defaults to $SHELL"
            />
          </div>
        )}

        {needsAuth && (
          <>
            <div className="field">
              <label>Authentication</label>
              <select
                value={draft.authMethod ?? 'agent'}
                onChange={(e) => set('authMethod', e.target.value as AuthMethod)}
              >
                <option value="agent">SSH agent</option>
                <option value="key">Private key</option>
                <option value="password">Password</option>
              </select>
            </div>

            {draft.authMethod === 'key' && (
              <div className="inset">
                <div className="field">
                  <label>Imported key</label>
                  <select
                    value={draft.keyId ?? ''}
                    onChange={(e) => {
                      set('keyId', e.target.value || undefined)
                      if (e.target.value) set('privateKeyPath', undefined)
                    }}
                  >
                    <option value="">— use a file on disk —</option>
                    {keys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.name} ({key.type})
                      </option>
                    ))}
                  </select>
                </div>

                {!draft.keyId && (
                  <div className="field">
                    <label>Key file</label>
                    <div className="field-row">
                      <input
                        value={draft.privateKeyPath ?? ''}
                        onChange={(e) => set('privateKeyPath', e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                      />
                      <button className="btn" onClick={pickExternalKey} disabled={pickerBusy}>
                        Browse…
                      </button>
                    </div>
                  </div>
                )}

                <button className="linklike" onClick={onManageKeys}>
                  Import or manage keys…
                </button>
              </div>
            )}

            {draft.authMethod === 'password' && (
              <div className="field">
                <label>Password — stored in the macOS Keychain, optional</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to be prompted each time"
                />
              </div>
            )}
          </>
        )}

        {draft.kind === 'ssh' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.trackCwd ?? false}
              onChange={(e) => set('trackCwd', e.target.checked)}
            />
            Follow the shell&rsquo;s directory in the file browser
          </label>
        )}

        <div className="modal-actions">
          {initial && (
            <button
              className="btn ghost danger"
              style={{ marginRight: 'auto' }}
              onClick={() => onDelete(initial.id)}
            >
              Delete
            </button>
          )}
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!canSave}
            onClick={() => onSave(draft, password || undefined)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
