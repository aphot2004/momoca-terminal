import { useEscape } from '../hooks/useEscape'
interface Props {
  sessionCount: number
  keyCount: number
  onClose: () => void
}

/** Help ▸ About. MobaXterm's about box, minus the licence nag. */
export function AboutDialog({ sessionCount, keyCount, onClose }: Props) {
  useEscape(onClose)
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal narrow" onMouseDown={(e) => e.stopPropagation()}>
        <h2>About MoMoca</h2>
        <p className="hint">
          A MobaXterm-style terminal for macOS: tabbed SSH, telnet, serial and local shells, an
          SFTP browser that follows your shell, port forwarding, macros and a tools workspace.
        </p>
        <table className="shortcut-table">
          <tbody>
            <tr>
              <th>Terminal</th>
              <td>xterm.js with the WebGL renderer</td>
            </tr>
            <tr>
              <th>Protocols</th>
              <td>SSH (ssh2), telnet, serial, local pty</td>
            </tr>
            <tr>
              <th>Saved sessions</th>
              <td>{sessionCount}</td>
            </tr>
            <tr>
              <th>Imported keys</th>
              <td>{keyCount}</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Secrets live in the macOS Keychain and are never read back into this window.
        </p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
