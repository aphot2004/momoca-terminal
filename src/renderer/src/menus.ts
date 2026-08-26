import type { Macro, SavedSession, TabState } from '@shared/types'
import type { MenuItem } from './components/ContextMenu'
import { SPLIT_PANES, type SplitLayout, type ViewSnapshot } from './view-state'
import type { ToolId as ToolsTabId } from './components/tools/ToolsPanel'
import type { NetworkTab } from './components/NetworkTools'

/**
 * Every menu in the window, as data.
 *
 * MobaXterm puts the same commands in a menu bar and on a buttons bar, so both
 * are built from these definitions — the ribbon's View button opens exactly the
 * items the View menu shows, and there is one place to change a label.
 */
export interface MenuActions {
  // Terminal
  newTab: () => void
  duplicateTab: () => void
  closeTab: () => void
  setTabTitle: () => void
  findInTerminal: () => void
  findNext: () => void
  saveTerminalText: () => void
  printTerminalText: () => void
  clearTerminal: () => void
  toggleMultiExec: () => void
  quit: () => void

  // Sessions
  newSession: () => void
  openSession: (session: SavedSession) => void

  // View
  setLayout: (layout: SplitLayout) => void
  toggleCompact: () => void
  toggleFullscreen: () => void
  minimize: () => void
  toggleMenuBar: () => void
  toggleButtonsBar: () => void
  showBothBars: () => void
  setButtonSize: (size: ViewSnapshot['buttonSize']) => void
  zoom: (by: number) => void
  resetZoom: () => void
  toggleSidebar: () => void
  setSidebarSide: (side: 'left' | 'right') => void
  toggleTabNumbers: () => void
  toggleTabClose: () => void
  toggleStats: () => void
  toggleTheme: () => void
  screenshot: () => void

  // X server
  startXServer: () => void
  xdmcpSession: () => void

  // Tools
  openTool: (tool: ToolsTabId) => void
  openNetwork: (tab: NetworkTab) => void
  openTunnels: () => void

  // Macros
  recordMacro: () => void
  playMacro: (macro: Macro) => void
  manageMacros: () => void

  // Settings
  openSettings: (tab: 'configuration' | 'shortcuts') => void
  importConfig: () => void
  exportConfig: () => void
  resetConfig: () => void
  openVault: () => void
  openKeys: () => void

  // Help
  openGuide: () => void
  openUnix: () => void
  openAbout: () => void
}

export interface MenuState {
  view: ViewSnapshot
  theme: 'dark' | 'light'
  sidebarOpen: boolean
  fullscreen: boolean
  sessions: SavedSession[]
  macros: Macro[]
  activeTab: TabState | null
  recording: boolean
}

export interface MenuDef {
  id: string
  label: string
  items: MenuItem[]
}

const LAYOUTS: { id: SplitLayout; label: string }[] = [
  { id: 'single', label: 'Single terminal mode' },
  { id: 'cols2', label: '2 terminals mode (vertical split)' },
  { id: 'rows2', label: '2 terminals mode (horizontal split)' },
  { id: 'grid4', label: '4 terminals mode' }
]

/** The View menu, shared by the menu bar and the ribbon's View button. */
export function viewMenuItems(state: MenuState, act: MenuActions): MenuItem[] {
  const { view } = state
  return [
    ...LAYOUTS.map((layout) => ({
      label: layout.label,
      checked: view.layout === layout.id,
      hint: SPLIT_PANES[layout.id] > 1 ? `${SPLIT_PANES[layout.id]} panes` : undefined,
      onClick: () => act.setLayout(layout.id)
    })),
    {},
    { label: 'Compact mode', checked: view.compact, hint: '⌘⇧E', onClick: act.toggleCompact },
    {
      label: 'Fullscreen mode',
      checked: state.fullscreen,
      hint: '⌃⌘F',
      onClick: act.toggleFullscreen
    },
    { label: 'Iconify MoMoca', hint: '⌘M', onClick: act.minimize },
    {},
    { label: 'Show menu bar', checked: view.menuBar, hint: '⌘⇧M', onClick: act.toggleMenuBar },
    { label: 'Show buttons bar', checked: view.buttonsBar, onClick: act.toggleButtonsBar },
    { label: 'Show both', onClick: act.showBothBars },
    {},
    {
      label: 'Small buttons',
      checked: view.buttonSize === 'small',
      onClick: () => act.setButtonSize('small')
    },
    {
      label: 'Standard buttons',
      checked: view.buttonSize === 'standard',
      onClick: () => act.setButtonSize('standard')
    },
    {
      label: 'Standard buttons with captions',
      checked: view.buttonSize === 'captions',
      onClick: () => act.setButtonSize('captions')
    },
    {},
    { label: 'Terminal zoom', hint: '⌘+', onClick: () => act.zoom(1) },
    { label: 'Terminal unzoom', hint: '⌘−', onClick: () => act.zoom(-1) },
    { label: `Reset zoom (${view.fontSize}px)`, hint: '⌘0', onClick: act.resetZoom },
    {},
    { label: 'Show/hide sidebar', checked: state.sidebarOpen, onClick: act.toggleSidebar },
    {
      label: 'Put sidebar on the left',
      checked: view.sidebarSide === 'left',
      onClick: () => act.setSidebarSide('left')
    },
    {
      label: 'Put sidebar on the right',
      checked: view.sidebarSide === 'right',
      onClick: () => act.setSidebarSide('right')
    },
    {},
    { label: 'Show tab numbers', checked: view.tabNumbers, onClick: act.toggleTabNumbers },
    { label: 'Show close button', checked: view.tabClose, onClick: act.toggleTabClose },
    {},
    { label: 'Show diagnostics bar', checked: view.showStats, onClick: act.toggleStats },
    { label: 'Toggle light/dark theme', checked: state.theme === 'light', onClick: act.toggleTheme },
    {},
    { label: 'Take a screenshot…', onClick: act.screenshot }
  ]
}

export function buildMenus(state: MenuState, act: MenuActions): MenuDef[] {
  const hasTab = Boolean(state.activeTab)
  const live = Boolean(state.activeTab && state.activeTab.status !== 'closed')

  return [
    {
      id: 'terminal',
      label: 'Terminal',
      items: [
        { label: 'Open new tab', hint: '⌘T', onClick: act.newTab },
        { label: 'Duplicate current tab', disabled: !hasTab, onClick: act.duplicateTab },
        { label: 'Close current tab', hint: '⌘W', disabled: !hasTab, onClick: act.closeTab },
        {},
        { label: 'Set tab title…', disabled: !hasTab, onClick: act.setTabTitle },
        { label: 'Find in terminal…', hint: '⌘F', disabled: !hasTab, onClick: act.findInTerminal },
        { label: 'Find next', hint: '⌘G', disabled: !hasTab, onClick: act.findNext },
        {},
        { label: 'Save terminal text…', disabled: !hasTab, onClick: act.saveTerminalText },
        { label: 'Print terminal text…', disabled: !hasTab, onClick: act.printTerminalText },
        { label: 'Clear terminal', disabled: !hasTab, onClick: act.clearTerminal },
        {},
        {
          label: 'Write commands on all terminals',
          checked: state.view.multiExec,
          onClick: act.toggleMultiExec
        },
        {},
        { label: 'Quit', hint: '⌘Q', danger: true, onClick: act.quit }
      ]
    },
    {
      id: 'sessions',
      label: 'Sessions',
      items: [
        { label: 'New session…', onClick: act.newSession },
        {},
        {
          label: 'User sessions',
          disabled: state.sessions.length === 0,
          submenu: state.sessions.length
            ? state.sessions.map((session) => ({
                label: session.folder ? `${session.folder} / ${session.name}` : session.name,
                hint: session.kind.toUpperCase(),
                onClick: () => act.openSession(session)
              }))
            : undefined
        }
      ]
    },
    { id: 'view', label: 'View', items: viewMenuItems(state, act) },
    {
      id: 'xserver',
      label: 'X server',
      items: [
        { label: 'Start X server', onClick: act.startXServer },
        { label: 'XDMCP session…', onClick: act.xdmcpSession }
      ]
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { heading: 'System' },
        { label: 'List running processes', onClick: () => act.openTool('processes') },
        { label: 'List hardware devices', onClick: () => act.openTool('hardware') },
        { label: 'Homebrew packages manager', onClick: () => act.openTool('brew') },
        { label: 'Root shell (sudo -i)', onClick: () => act.openTool('rootshell') },
        { heading: 'Office' },
        { label: 'Text editor', onClick: () => act.openTool('editor') },
        { label: 'Compare files', onClick: () => act.openTool('diff') },
        { label: 'Ascii table', onClick: () => act.openTool('ascii') },
        { heading: 'Network' },
        { label: 'Network services', onClick: () => act.openNetwork('ping') },
        { label: 'SSH tunnels (port forwarding)', onClick: act.openTunnels },
        { label: 'SSH key generator', onClick: () => act.openTool('keygen') },
        { label: 'List open network ports', onClick: () => act.openTool('ports') },
        { label: 'Wake On Lan', onClick: () => act.openTool('wol') },
        { label: 'Network scanner', onClick: () => act.openNetwork('discover') },
        { label: 'Ports scanner', onClick: () => act.openNetwork('scan') },
        { label: 'Network packets capture', onClick: () => act.openTool('capture') }
      ]
    },
    {
      id: 'macros',
      label: 'Macros',
      items: [
        {
          label: state.recording ? 'Recording — use the floating bar' : 'Record new macro',
          disabled: state.recording || !live,
          onClick: act.recordMacro
        },
        {},
        {
          label: 'Saved macros',
          disabled: state.macros.length === 0 || !live,
          submenu: state.macros.length
            ? state.macros.map((macro) => ({
                label: macro.name,
                hint: `${macro.steps.length} steps`,
                onClick: () => act.playMacro(macro)
              }))
            : undefined
        },
        { label: 'Manage macros…', onClick: act.manageMacros }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        { label: 'Configuration…', onClick: () => act.openSettings('configuration') },
        { label: 'Keyboard shortcuts…', onClick: () => act.openSettings('shortcuts') },
        {},
        { label: 'Import configuration…', onClick: act.importConfig },
        { label: 'Export configuration…', onClick: act.exportConfig },
        { label: 'Reset configuration', danger: true, onClick: act.resetConfig },
        {},
        { label: 'Saved credentials…', onClick: act.openVault },
        { label: 'SSH keys…', onClick: act.openKeys }
      ]
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Requirements and installed tools…', onClick: act.openGuide },
        { label: 'Unix command availability…', onClick: act.openUnix },
        {},
        { label: 'About MoMoca', onClick: act.openAbout }
      ]
    }
  ]
}
