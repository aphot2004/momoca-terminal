import { useState } from 'react'
import { useEscape } from '../../hooks/useEscape'
import { AsciiTable } from './AsciiTable'
import { BrewPackages } from './BrewPackages'
import { DiffTool } from './DiffTool'
import { HardwareTool } from './HardwareTool'
import { KeyGenTool } from './KeyGenTool'
import { PortsTool } from './PortsTool'
import { ProcessTool } from './ProcessTool'
import { TextEditorTool } from './TextEditorTool'
import { WakeOnLanTool } from './WakeOnLanTool'

export type ToolId =
  | 'processes'
  | 'hardware'
  | 'brew'
  | 'rootshell'
  | 'editor'
  | 'diff'
  | 'ascii'
  | 'keygen'
  | 'ports'
  | 'wol'
  | 'capture'

interface Props {
  onClose: () => void
  /** Which tool to open on; the Tools menu points straight at one. */
  initial?: ToolId
  /** Runs a command in a new local terminal; null when that isn't possible. */
  onRunLocal: (command: string, title: string) => void
  onKeysChanged: () => void
}

interface Entry {
  id: ToolId
  label: string
  hint: string
}

/** Grouped the way MobaXterm's Tools menu is, minus the games. */
const GROUPS: { title: string; items: Entry[] }[] = [
  {
    title: 'System',
    items: [
      { id: 'processes', label: 'Running processes', hint: 'List and signal processes' },
      { id: 'hardware', label: 'Hardware devices', hint: 'CPU, memory, disks, displays' },
      { id: 'brew', label: 'Homebrew packages', hint: 'Installed and outdated formulae' },
      { id: 'rootshell', label: 'Root shell', hint: 'A local terminal running sudo -i' }
    ]
  },
  {
    title: 'Office',
    items: [
      { id: 'editor', label: 'Text editor', hint: 'Open and edit a local file' },
      { id: 'diff', label: 'Compare files', hint: 'Unified diff of two files' },
      { id: 'ascii', label: 'ASCII table', hint: 'Codes, hex and control names' }
    ]
  },
  {
    title: 'Network',
    items: [
      { id: 'keygen', label: 'SSH key generator', hint: 'Create a keypair and import it' },
      { id: 'ports', label: 'Open network ports', hint: 'What is listening on this Mac' },
      { id: 'wol', label: 'Wake on LAN', hint: 'Send a magic packet' },
      { id: 'capture', label: 'Packet capture', hint: 'Run tcpdump in a terminal' }
    ]
  }
]

export function ToolsPanel({ onClose, onRunLocal, onKeysChanged, initial }: Props) {
  useEscape(onClose)
  const [tool, setTool] = useState<ToolId>(initial ?? 'processes')

  const active = GROUPS.flatMap((g) => g.items).find((i) => i.id === tool)

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal tools-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tools-layout">
          <nav className="tools-nav">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="tools-group">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`tools-item${tool === item.id ? ' active' : ''}`}
                    onClick={() => setTool(item.id)}
                    title={item.hint}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <section className="tools-body">
            <h2>{active?.label}</h2>

            {tool === 'processes' && <ProcessTool />}
            {tool === 'hardware' && <HardwareTool />}
            {tool === 'brew' && <BrewPackages onRunLocal={onRunLocal} />}
            {tool === 'editor' && <TextEditorTool />}
            {tool === 'diff' && <DiffTool />}
            {tool === 'ascii' && <AsciiTable />}
            {tool === 'keygen' && <KeyGenTool onImported={onKeysChanged} />}
            {tool === 'ports' && <PortsTool />}
            {tool === 'wol' && <WakeOnLanTool />}

            {tool === 'rootshell' && (
              <>
                <p className="hint">
                  Opens a local terminal running <code>sudo -i</code>. macOS will ask for your
                  password in that terminal — it is never handled by this app.
                </p>
                <button
                  className="btn primary"
                  onClick={() => {
                    onRunLocal('sudo -i', 'root')
                    onClose()
                  }}
                >
                  Open root shell
                </button>
              </>
            )}

            {tool === 'capture' && <CaptureTool onRunLocal={onRunLocal} onClose={onClose} />}
          </section>
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Packet capture needs root and is inherently a streaming, long-running thing,
 * so it belongs in a terminal rather than a panel. This builds the command.
 */
function CaptureTool({
  onRunLocal,
  onClose
}: {
  onRunLocal: (command: string, title: string) => void
  onClose: () => void
}) {
  const [iface, setIface] = useState('en0')
  const [filter, setFilter] = useState('tcp port 443')
  const [count, setCount] = useState(200)

  const command = `sudo tcpdump -i ${iface || 'en0'} -n -c ${count}${filter.trim() ? ` ${filter.trim()}` : ''}`

  return (
    <>
      <p className="hint">
        tcpdump needs root, so this opens a terminal and runs it there — macOS asks for your
        password in that terminal. Add <code>-w file.pcap</code> to save a capture for Wireshark.
      </p>

      <div className="field-row">
        <div className="field" style={{ width: 120 }}>
          <label>Interface</label>
          <input value={iface} onChange={(e) => setIface(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Filter (pcap syntax)</label>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ width: 100 }}>
          <label>Packets</label>
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </div>
      </div>

      <div className="cmd-row">
        <code>{command}</code>
        <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(command)}>
          Copy
        </button>
      </div>

      <button
        className="btn primary"
        style={{ marginTop: 10 }}
        onClick={() => {
          onRunLocal(command, `tcpdump ${iface}`)
          onClose()
        }}
      >
        Run in a terminal
      </button>
    </>
  )
}
