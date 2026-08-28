import { useState } from 'react'
import { useEscape } from '../hooks/useEscape'
import { useView, viewActions, type ButtonSize } from '../view-state'
import type { ThemeName } from '../theme'

export type SettingsTab = 'configuration' | 'shortcuts'

interface Props {
  initialTab: SettingsTab
  theme: ThemeName
  onTheme: (theme: ThemeName) => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onClose: () => void
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '⌘T', what: 'Open a new local terminal tab' },
  { keys: '⌘W', what: 'Close the current tab' },
  { keys: '⌘1 – ⌘9', what: 'Jump to a tab by number' },
  { keys: '⌘F', what: 'Find in the terminal' },
  { keys: '⌘G', what: 'Find the next match' },
  { keys: '⌘+ / ⌘−', what: 'Terminal zoom and unzoom' },
  { keys: '⌘0', what: 'Reset the terminal zoom' },
  { keys: '⌘⇧E', what: 'Compact mode — hides the menu and buttons bars' },
  { keys: '⌘⇧M', what: 'Show or hide the menu bar' },
  { keys: '⌘M', what: 'Iconify (minimise) the window' },
  { keys: '⌃⌘F', what: 'Fullscreen mode' },
  { keys: '⇧PgUp / ⇧PgDn', what: 'Page through the scrollback' },
  { keys: '⇧Home / ⇧End', what: 'Jump to the top or the newest output' },
  { keys: '⌘↑ / ⌘↓', what: 'Page through the scrollback' }
]

const BUTTON_SIZES: { id: ButtonSize; label: string }[] = [
  { id: 'small', label: 'Small buttons' },
  { id: 'standard', label: 'Standard buttons' },
  { id: 'captions', label: 'Standard buttons with captions' }
]

/** Settings ▸ Configuration: the same switches the View menu offers, in one place. */
export function SettingsDialog({
  initialTab,
  theme,
  onTheme,
  sidebarOpen,
  onToggleSidebar,
  onClose
}: Props) {
  useEscape(onClose)
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const view = useView()

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="panel-tabs">
          <button
            className={`panel-tab${tab === 'configuration' ? ' active' : ''}`}
            onClick={() => setTab('configuration')}
          >
            Configuration
          </button>
          <button
            className={`panel-tab${tab === 'shortcuts' ? ' active' : ''}`}
            onClick={() => setTab('shortcuts')}
          >
            Keyboard shortcuts
          </button>
        </div>

        {tab === 'configuration' ? (
          <div className="settings-body">
            <section>
              <h3>Terminal</h3>
              <label className="field-row setting-row">
                <span>Font size</span>
                <input
                  type="number"
                  min={8}
                  max={28}
                  value={view.fontSize}
                  onChange={(e) => viewActions.setFontSize(Number(e.target.value))}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={theme === 'dark'}
                  onChange={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
                />
                Dark theme
              </label>
            </section>

            <section>
              <h3>Toolbars, menus and buttons</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={view.menuBar}
                  onChange={viewActions.toggleMenuBar}
                />
                Show menu bar
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={view.buttonsBar}
                  onChange={viewActions.toggleButtonsBar}
                />
                Show buttons bar
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={view.compact} onChange={viewActions.toggleCompact} />
                Compact mode
              </label>
              {BUTTON_SIZES.map((size) => (
                <label className="checkbox" key={size.id}>
                  <input
                    type="radio"
                    name="button-size"
                    checked={view.buttonSize === size.id}
                    onChange={() => viewActions.setButtonSize(size.id)}
                  />
                  {size.label}
                </label>
              ))}
            </section>

            <section>
              <h3>Sidebar and tabs</h3>
              <label className="checkbox">
                <input type="checkbox" checked={sidebarOpen} onChange={onToggleSidebar} />
                Show sidebar
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="sidebar-side"
                  checked={view.sidebarSide === 'left'}
                  onChange={() => viewActions.setSidebarSide('left')}
                />
                Put sidebar on the left
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="sidebar-side"
                  checked={view.sidebarSide === 'right'}
                  onChange={() => viewActions.setSidebarSide('right')}
                />
                Put sidebar on the right
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={view.tabNumbers}
                  onChange={viewActions.toggleTabNumbers}
                />
                Show tab numbers
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={view.tabClose}
                  onChange={viewActions.toggleTabClose}
                />
                Show close button on tabs
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={view.showStats} onChange={viewActions.toggleStats} />
                Show diagnostics bar
              </label>
            </section>

            <p className="hint">
              Settings apply immediately and are remembered. Settings ▸ Reset configuration puts
              every one of them back to its default.
            </p>
          </div>
        ) : (
          <div className="settings-body">
            <table className="shortcut-table">
              <tbody>
                {SHORTCUTS.map((row) => (
                  <tr key={row.keys}>
                    <th>{row.keys}</th>
                    <td>{row.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
