import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EXTERNAL_KINDS,
  type ConnectOptions,
  type Macro,
  type RemoteStats,
  type SavedSession,
  type SystemStats,
  type TabState,
  type ToolId
} from '@shared/types'
import { ToolGuide } from './components/ToolGuide'
import { VaultDialog } from './components/VaultDialog'
import { NetworkTools, type NetworkTab } from './components/NetworkTools'
import { MacroManager } from './components/MacroManager'
import { UnixTools } from './components/UnixTools'
import { RecordingBar } from './components/RecordingBar'
import { ToolsPanel, type ToolId as ToolsTabId } from './components/tools/ToolsPanel'
import { ContextMenu } from './components/ContextMenu'
import { MenuBar } from './components/MenuBar'
import { AboutDialog } from './components/AboutDialog'
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog'
import { usePrompt } from './components/InputDialog'
import { buildMenus, viewMenuItems, type MenuActions } from './menus'
import {
  PANE_RECTS,
  SPLIT_PANES,
  exportView,
  importView,
  useView,
  viewActions
} from './view-state'
import { macroSpeed, playMacro, startRecording, useRecorder } from './macro-recorder'
import { findInTerminal, findNextInTerminal, getTerminal, terminalText } from './terminal-registry'
import { KeyManager } from './components/KeyManager'
import { StatsBar } from './components/StatsBar'
import { TunnelManager } from './components/TunnelManager'
import { LeftPanel, type PanelTab } from './components/LeftPanel'
import { PromptOverlay, type PromptRequest } from './components/PromptOverlay'
import { Ribbon } from './components/Ribbon'
import { SessionDialog } from './components/SessionDialog'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WelcomeTab } from './components/WelcomeTab'
import { loadTheme, persistTheme, type ThemeName } from './theme'

/** Connection details are captured at tab-open time so TerminalPane can mount once. */
type TabConnect = Omit<ConnectOptions, 'cols' | 'rows'>

/** Parses `user@host`, `user@host:port`, or a bare host from the quick-connect box. */
function parseQuickConnect(input: string): Omit<SavedSession, 'id'> | null {
  const match = /^(?:([^@\s]+)@)?([^\s:]+)(?::(\d+))?$/.exec(input.trim())
  if (!match) return null
  const [, username, host, port] = match
  return {
    name: username ? `${username}@${host}` : host,
    kind: 'ssh',
    folder: '',
    host,
    port: port ? Number(port) : 22,
    username: username || undefined,
    authMethod: 'agent',
    trackCwd: true
  }
}

export function App() {
  const [sessions, setSessions] = useState<SavedSession[]>([])
  const [macros, setMacros] = useState<Macro[]>([])
  const [keyCount, setKeyCount] = useState(0)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ session: SavedSession | null } | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [showTunnels, setShowTunnels] = useState(false)
  const [activeTunnels, setActiveTunnels] = useState(0)
  const [stats, setStats] = useState<SystemStats | null>(null)
  /** Server metrics keyed by tab, so switching tabs switches the bar. */
  const [remoteStats, setRemoteStats] = useState<Record<string, RemoteStats>>({})
  const [showLocalStats, setShowLocalStats] = useState(false)
  const [guide, setGuide] = useState<{ focus?: ToolId } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 'unlock' is shown automatically at startup when a master password is set. */
  const [vault, setVault] = useState<'unlock' | 'settings' | null>(null)
  /** Which tool each workspace opens on; null means the panel is closed. */
  const [network, setNetwork] = useState<NetworkTab | null>(null)
  const [toolbox, setToolbox] = useState<ToolsTabId | null>(null)
  const [showMacros, setShowMacros] = useState(false)
  const [showUnix, setShowUnix] = useState(false)
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const recorder = useRecorder()
  const view = useView()
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [queue, setQueue] = useState<PromptRequest[]>([])
  const { ask, dialog: promptDialog } = usePrompt()

  const [theme, setTheme] = useState<ThemeName>(loadTheme)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panel, setPanel] = useState<PanelTab>('sessions')

  const connects = useRef(new Map<string, TabConnect>())
  const nextTab = useRef(0)

  useEffect(() => {
    persistTheme(theme)
  }, [theme])

  const reloadSessions = useCallback(async () => {
    setSessions(await window.api.sessions.list())
  }, [])

  const reloadKeys = useCallback(async () => {
    setKeyCount((await window.api.keys.list()).length)
  }, [])

  const reloadMacros = useCallback(async () => {
    setMacros(await window.api.macros.list())
  }, [])

  useEffect(() => {
    void reloadSessions()
    void reloadKeys()
    void reloadMacros()
    void window.api.vault.status().then((status) => {
      if (status.locked) setVault('unlock')
    })
  }, [reloadSessions, reloadKeys, reloadMacros])

  // --- backend events -----------------------------------------------------

  useEffect(() => {
    const offStatus = window.api.term.onStatus(({ tabId, status, error, sftp }) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.tabId === tabId
            ? { ...tab, status: status as TabState['status'], error, sftp: sftp ?? tab.sftp }
            : tab
        )
      )
      // Reveal the file browser as soon as a session proves it has SFTP.
      if (sftp) setPanel('sftp')
    })

    const offExit = window.api.term.onExit(({ tabId }) => {
      setTabs((current) =>
        current.map((tab) => (tab.tabId === tabId ? { ...tab, status: 'closed' } : tab))
      )
    })

    const offSecret = window.api.prompts.onSecret((p) =>
      setQueue((current) => [...current, { type: 'secret', ...p }])
    )
    const offHostKey = window.api.prompts.onHostKey((p) =>
      setQueue((current) => [...current, { type: 'hostkey', ...p }])
    )
    const offStats = window.api.stats.onUpdate(setStats)
    const offRemote = window.api.stats.onRemote(({ tabId, stats: remote }) =>
      setRemoteStats((current) => ({ ...current, [tabId]: remote }))
    )
    const offTunnels = window.api.tunnels.onStatus((state) =>
      setActiveTunnels(state.filter((s) => s.state === 'running').length)
    )

    void window.api.tunnels
      .status()
      .then((state) => setActiveTunnels(state.filter((s) => s.state === 'running').length))

    return () => {
      offStatus()
      offExit()
      offSecret()
      offHostKey()
      offStats()
      offRemote()
      offTunnels()
    }
  }, [])

  // Transient status line for external launches and folder downloads.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  // --- tab lifecycle ------------------------------------------------------

  /** Returns the new tab's id, or null for kinds handed to another app. */
  const openTab = useCallback((session: SavedSession | Omit<SavedSession, 'id'>): string | null => {
    // RDP, VNC, Browser and XDMCP are handed to another application rather
    // than rendered in a tab; a missing client opens the requirements guide.
    if (EXTERNAL_KINDS.includes(session.kind)) {
      void window.api.tools
        .launch(session as SavedSession)
        .then((result) => {
          setToast(result.message)
          if (!result.launched && result.tool) setGuide({ focus: result.tool })
        })
        .catch((err: Error) => setToast(err.message))
      return null
    }

    const tabId = `tab-${++nextTab.current}-${Date.now()}`
    const saved = 'id' in session && session.id ? (session as SavedSession) : null

    connects.current.set(
      tabId,
      saved
        ? { tabId, sessionId: saved.id }
        : { tabId, session: session as Omit<SavedSession, 'id'> }
    )

    setTabs((current) => [
      ...current,
      {
        tabId,
        sessionId: saved?.id ?? null,
        title: session.name,
        kind: session.kind,
        status: 'connecting',
        sftp: false,
        cwd: ''
      }
    ])
    setActiveId(tabId)
    return tabId
  }, [])

  const openLocalTab = useCallback(() => {
    openTab({ name: 'Local', kind: 'local', folder: '' })
  }, [openTab])

  const quickConnect = useCallback(
    (target: string) => {
      const session = parseQuickConnect(target)
      if (session) openTab(session)
    },
    [openTab]
  )

  const closeTab = useCallback((tabId: string) => {
    connects.current.delete(tabId)
    setRemoteStats((current) => {
      const next = { ...current }
      delete next[tabId]
      return next
    })
    setTabs((current) => {
      const next = current.filter((tab) => tab.tabId !== tabId)
      setActiveId((active) => (active === tabId ? (next[next.length - 1]?.tabId ?? null) : active))
      return next
    })
  }, [])

  const setTitle = useCallback((tabId: string, title: string) => {
    setTabs((current) =>
      current.map((tab) => (tab.tabId === tabId ? { ...tab, title: title || tab.title } : tab))
    )
  }, [])

  const setCwd = useCallback((tabId: string, cwd: string) => {
    setTabs((current) => current.map((tab) => (tab.tabId === tabId ? { ...tab, cwd } : tab)))
  }, [])

  const activeTab = tabs.find((tab) => tab.tabId === activeId) ?? null

  const toggleFullscreen = useCallback(() => {
    setFullscreen((current) => {
      const next = !current
      void window.api.window.setFullScreen(next)
      return next
    })
  }, [])

  // --- menu commands ------------------------------------------------------

  /** Terminal ▸ Find: one prompt, then repeatable with Find next (⌘G). */
  const promptFind = useCallback(async () => {
    if (!activeId) return
    const query = await ask({
      title: 'Find in terminal',
      label: 'Search the scrollback for',
      confirmLabel: 'Find'
    })
    if (!query) return
    if (!findInTerminal(activeId, query)) setToast(`No match for “${query}”`)
  }, [activeId, ask])

  const findAgain = useCallback(() => {
    if (!activeId) return
    if (!findNextInTerminal(activeId)) setToast('Nothing to find — use Find in terminal first')
  }, [activeId])

  const menuActions: MenuActions = {
    newTab: openLocalTab,
    duplicateTab: () => {
      if (!activeId) return
      const connect = connects.current.get(activeId)
      if (!connect) return
      const saved = connect.sessionId
        ? sessions.find((session) => session.id === connect.sessionId)
        : null
      if (saved) openTab(saved)
      else if (connect.session) openTab(connect.session)
    },
    closeTab: () => {
      if (activeId) closeTab(activeId)
    },
    setTabTitle: () => {
      if (!activeTab) return
      void ask({
        title: 'Set tab title',
        label: 'Tab title',
        initial: activeTab.title,
        confirmLabel: 'Rename'
      }).then((title) => {
        if (title) setTitle(activeTab.tabId, title)
      })
    },
    findInTerminal: () => void promptFind(),
    findNext: findAgain,
    saveTerminalText: () => {
      if (!activeTab) return
      const text = terminalText(activeTab.tabId)
      void window.api.toolbox
        .saveFile(`${activeTab.title.replace(/[/:]/g, '-')}.txt`)
        .then(async (path) => {
          if (!path) return
          await window.api.toolbox.writeFile(path, text)
          setToast(`Saved the terminal text to ${path}`)
        })
        .catch((err: Error) => setToast(err.message))
    },
    printTerminalText: () => {
      if (!activeTab) return
      void window.api.window
        .printText(activeTab.title, terminalText(activeTab.tabId))
        .catch((err: Error) => setToast(err.message))
    },
    clearTerminal: () => getTerminal(activeId)?.term.clear(),
    toggleMultiExec: viewActions.toggleMultiExec,
    quit: () => window.close(),

    newSession: () => setEditing({ session: null }),
    openSession: (session) => openTab(session),

    setLayout: viewActions.setLayout,
    toggleCompact: viewActions.toggleCompact,
    toggleFullscreen,
    minimize: () => void window.api.window.minimize(),
    toggleMenuBar: viewActions.toggleMenuBar,
    toggleButtonsBar: viewActions.toggleButtonsBar,
    showBothBars: viewActions.showBothBars,
    setButtonSize: viewActions.setButtonSize,
    zoom: viewActions.zoom,
    resetZoom: viewActions.resetZoom,
    toggleSidebar: () => setSidebarOpen((open) => !open),
    setSidebarSide: viewActions.setSidebarSide,
    toggleTabNumbers: viewActions.toggleTabNumbers,
    toggleTabClose: viewActions.toggleTabClose,
    toggleStats: viewActions.toggleStats,
    toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    screenshot: () => {
      void window.api.window
        .screenshot()
        .then((path) => setToast(path ? `Saved a screenshot to ${path}` : 'Screenshot cancelled'))
        .catch((err: Error) => setToast(err.message))
    },

    startXServer: () => {
      void window.api.tools
        .startXServer()
        .then((result) => {
          setToast(result.message)
          if (!result.launched && result.tool) setGuide({ focus: result.tool })
        })
        .catch((err: Error) => setToast(err.message))
    },
    xdmcpSession: () => {
      void ask({
        title: 'XDMCP session',
        label: 'Host running the display manager',
        placeholder: 'host or IP',
        confirmLabel: 'Connect'
      }).then((host) => {
        if (host) openTab({ name: `XDMCP ${host}`, kind: 'xdmcp', folder: '', host })
      })
    },

    openTool: (tool) => setToolbox(tool),
    openNetwork: (tab) => setNetwork(tab),
    openTunnels: () => setShowTunnels(true),

    recordMacro: () => {
      if (!activeId) return
      startRecording(activeId)
    },
    playMacro: (macro) => {
      if (!activeId) return
      void playMacro(activeId, macro.steps, macroSpeed(macro)).catch((err: Error) =>
        setToast(err.message)
      )
    },
    manageMacros: () => setShowMacros(true),

    openSettings: (tab) => setSettings(tab),
    importConfig: () => void importConfiguration(),
    exportConfig: () => void exportConfiguration(),
    resetConfig: () => {
      if (window.confirm('Put every view and interface setting back to its default?')) {
        viewActions.reset()
        setToast('Configuration reset')
      }
    },
    openVault: () => setVault('settings'),
    openKeys: () => setShowKeys(true),

    openGuide: () => setGuide({}),
    openUnix: () => setShowUnix(true),
    openAbout: () => setShowAbout(true)
  }

  /** Settings ▸ Export: sessions, macros and the view settings as one JSON file. */
  async function exportConfiguration(): Promise<void> {
    try {
      const path = await window.api.toolbox.saveFile('mobaclone-config.json')
      if (!path) return
      const payload = {
        kind: 'mobaclone-configuration',
        exportedAt: new Date().toISOString(),
        view: exportView(),
        sessions,
        macros
      }
      await window.api.toolbox.writeFile(path, JSON.stringify(payload, null, 2))
      setToast(`Exported the configuration to ${path}`)
    } catch (err) {
      setToast((err as Error).message)
    }
  }

  /**
   * Settings ▸ Import. Sessions and macros are merged rather than replaced —
   * the store holds real saved hosts, and an import must never wipe them.
   * Secrets are not in the file: they live in the Keychain and are never read
   * back into this window.
   */
  async function importConfiguration(): Promise<void> {
    try {
      const path = await window.api.toolbox.pickFile('Import configuration')
      if (!path) return
      const parsed = JSON.parse(await window.api.toolbox.readFile(path)) as {
        view?: Record<string, unknown>
        sessions?: SavedSession[]
        macros?: Macro[]
      }
      if (parsed.view) importView(parsed.view)

      let imported = 0
      for (const session of parsed.sessions ?? []) {
        // Drop the id so an import lands as a new session instead of
        // overwriting whatever happens to share that id here.
        const { id: _id, ...rest } = session
        await window.api.sessions.save(rest as SavedSession)
        imported++
      }
      for (const macro of parsed.macros ?? []) {
        const { id: _id, ...rest } = macro
        await window.api.macros.save(rest)
      }
      await reloadSessions()
      await reloadMacros()
      setToast(
        `Imported ${imported} session${imported === 1 ? '' : 's'} and ${
          parsed.macros?.length ?? 0
        } macros`
      )
    } catch (err) {
      setToast((err as Error).message)
    }
  }

  // --- keyboard shortcuts -------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey) return

      if (event.key === 't') {
        event.preventDefault()
        openLocalTab()
      } else if (event.key === 'w') {
        event.preventDefault()
        if (activeId) closeTab(activeId)
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        viewActions.zoom(1)
      } else if (event.key === '-') {
        event.preventDefault()
        viewActions.zoom(-1)
      } else if (event.key === 'f' && event.ctrlKey) {
        event.preventDefault()
        toggleFullscreen()
      } else if (event.key === 'f') {
        event.preventDefault()
        void promptFind()
      } else if (event.key === 'g') {
        event.preventDefault()
        findAgain()
      } else if (event.key === 'm' && event.shiftKey) {
        // The menu bar can hide itself, so its way back must not live in it.
        event.preventDefault()
        viewActions.toggleMenuBar()
      } else if (event.key === 'm') {
        event.preventDefault()
        void window.api.window.minimize()
      } else if (event.key === 'e' && event.shiftKey) {
        // Compact mode hides the ribbon, so it needs a way out that is not in it.
        event.preventDefault()
        viewActions.toggleCompact()
      } else if (event.key === '0') {
        event.preventDefault()
        viewActions.resetZoom()
      } else if (/^[1-9]$/.test(event.key)) {
        const target = tabs[Number(event.key) - 1]
        if (target) {
          event.preventDefault()
          setActiveId(target.tabId)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, closeTab, findAgain, openLocalTab, promptFind, tabs, toggleFullscreen])

  // --- session persistence ------------------------------------------------

  const saveSession = async (draft: SavedSession, password?: string) => {
    const saved = await window.api.sessions.save(draft)
    if (password) {
      try {
        await window.api.secrets.store(saved.id, password)
      } catch (err) {
        window.alert(`Session saved, but the secret could not be stored: ${String(err)}`)
      }
    }
    await reloadSessions()
    setEditing(null)
  }

  const deleteSession = async (id: string) => {
    await window.api.sessions.remove(id)
    await window.api.secrets.remove(id).catch(() => {})
    await reloadSessions()
    setEditing(null)
  }

  /**
   * Which tabs occupy the split panes. The active tab always takes the first
   * slot so focusing a tab never hides it, and the remaining slots are filled
   * with the other tabs in order.
   */
  const paneCount = SPLIT_PANES[view.layout]
  const paneTabs = (() => {
    if (paneCount === 1) return activeTab ? [activeTab.tabId] : []
    const rest = tabs.filter((t) => t.tabId !== activeId).map((t) => t.tabId)
    const ordered = activeTab ? [activeTab.tabId, ...rest] : rest
    return ordered.slice(0, paneCount)
  })()

  // MultiExec broadcasts to exactly what is on screen.
  useEffect(() => {
    viewActions.setVisibleTabs(paneTabs)
  }, [paneTabs.join('|')])

  const menuState = {
    view,
    theme,
    sidebarOpen,
    fullscreen,
    sessions,
    macros,
    activeTab,
    recording: recorder.recording
  }

  // Compact mode and a hidden buttons bar both take the ribbon away, so the tab
  // strip keeps a door back to the View menu.
  const ribbonHidden = view.compact || !view.buttonsBar

  return (
    <div
      className={`app${sidebarOpen ? '' : ' no-sidebar'}${view.compact ? ' compact' : ''}${
        view.sidebarSide === 'right' ? ' sidebar-right' : ''
      }${view.showStats ? '' : ' no-stats'}`}
    >
      <div className="titlebar" />

      <div className="chrome">
        {view.menuBar && !view.compact && (
          <MenuBar menus={buildMenus(menuState, menuActions)} onOpen={() => void reloadMacros()} />
        )}

        {view.buttonsBar && !view.compact && (
          <Ribbon
            onNewSession={() => setEditing({ session: null })}
            onLocalTerminal={openLocalTab}
            onKeys={() => setShowKeys(true)}
            onVault={() => setVault('settings')}
            onTunnels={() => setShowTunnels(true)}
            onNetwork={() => setNetwork('ping')}
            onMacros={() => setShowMacros(true)}
            onUnix={() => setShowUnix(true)}
            onToolbox={() => setToolbox('processes')}
            onView={(x, y) => setViewMenu({ x, y })}
            onToggleMultiExec={viewActions.toggleMultiExec}
            multiExec={view.multiExec}
            splitActive={view.layout !== 'single'}
            recording={recorder.recording}
            onGuide={() => setGuide({})}
            activeTunnels={activeTunnels}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleFiles={() => setPanel((p) => (p === 'sftp' ? 'sessions' : 'sftp'))}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            onExit={() => window.close()}
            filesEnabled={Boolean(activeTab?.sftp)}
            sidebarOpen={sidebarOpen}
            filesOpen={panel === 'sftp'}
          />
        )}
      </div>

      <div className="body">
        {sidebarOpen && (
          <LeftPanel
            sessions={sessions}
            activeTab={activeTab}
            panel={panel}
            onPanel={setPanel}
            onOpen={openTab}
            onEdit={(session) => setEditing({ session })}
            onNew={() => setEditing({ session: null })}
            onQuickConnect={quickConnect}
          />
        )}

        <div className="main">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={closeTab}
            onNew={openLocalTab}
            compactView={ribbonHidden ? (x, y) => setViewMenu({ x, y }) : undefined}
          />

          <div className="terminal-stack">
            {/*
              Every terminal stays mounted in this one container for its whole
              life — moving a TerminalPane between React parents would unmount
              it and kill the session. Splits are done by positioning each pane
              over its slot instead, and tabs with no slot are simply hidden.
            */}
            {tabs.map((tab) => {
              const slot = paneTabs.indexOf(tab.tabId)
              return (
                <TerminalPane
                  key={tab.tabId}
                  tab={tab}
                  slot={slot === -1 ? null : PANE_RECTS[view.layout][slot]}
                  focused={tab.tabId === activeId}
                  split={paneCount > 1}
                  theme={theme}
                  fontSize={view.fontSize}
                  connect={connects.current.get(tab.tabId)!}
                  onFocus={() => setActiveId(tab.tabId)}
                  onTitle={setTitle}
                  onCwd={setCwd}
                />
              )
            })}

            {view.multiExec && paneTabs.length > 0 && (
              <div className="multiexec-banner">
                MultiExec — typing goes to {paneTabs.length} terminal
                {paneTabs.length === 1 ? '' : 's'}
              </div>
            )}

            {!tabs.length && (
              <WelcomeTab theme={theme} onTheme={setTheme} onLocalTerminal={openLocalTab} />
            )}
          </div>
        </div>
      </div>

      {view.showStats && (
        <StatsBar
          local={stats}
          remote={activeTab ? (remoteStats[activeTab.tabId] ?? null) : null}
          showLocal={showLocalStats}
          onToggleScope={() => setShowLocalStats((v) => !v)}
        />
      )}
      <StatusBar
        tab={activeTab}
        keyCount={keyCount}
        sessionCount={sessions.length}
        notice={toast}
      />

      {showTunnels && (
        <TunnelManager sessions={sessions} onClose={() => setShowTunnels(false)} />
      )}

      {viewMenu && (
        <ContextMenu
          x={viewMenu.x}
          y={viewMenu.y}
          items={viewMenuItems(menuState, menuActions)}
          onClose={() => setViewMenu(null)}
        />
      )}

      {toolbox && (
        <ToolsPanel
          initial={toolbox}
          onClose={() => setToolbox(null)}
          onRunLocal={(command, title) => {
            // Open a local shell and type the command into it, so its output
            // and any password prompt land in a real terminal.
            const tabId = openTab({ name: title, kind: 'local', folder: '' })
            if (tabId) {
              setTimeout(() => void window.api.term.write(tabId, `${command}\n`), 1200)
            }
          }}
          onKeysChanged={() => void reloadKeys()}
        />
      )}

      <RecordingBar
        onSaved={() => {
          void reloadMacros()
          setShowMacros(true)
        }}
      />

      {guide && <ToolGuide focus={guide.focus} onClose={() => setGuide(null)} />}

      {network && (
        <NetworkTools
          initialTab={network}
          onClose={() => setNetwork(null)}
          onConnect={(host, port) => {
            setNetwork(null)
            openTab({ name: host, kind: 'ssh', folder: '', host, port, authMethod: 'agent', trackCwd: true })
          }}
        />
      )}

      {showMacros && (
        <MacroManager
          targets={tabs
            .filter((t) => t.status !== 'closed')
            .map((t) => ({ tabId: t.tabId, title: t.title }))}
          activeTabId={activeTab?.tabId ?? null}
          onClose={() => {
            setShowMacros(false)
            void reloadMacros()
          }}
        />
      )}

      {showUnix && (
        <UnixTools
          onClose={() => setShowUnix(false)}
          onRun={
            activeTab
              ? (command) => {
                  void window.api.term.write(activeTab.tabId, `${command}\n`)
                  setShowUnix(false)
                }
              : null
          }
        />
      )}

      {settings && (
        <SettingsDialog
          initialTab={settings}
          theme={theme}
          onTheme={setTheme}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onClose={() => setSettings(null)}
        />
      )}

      {showAbout && (
        <AboutDialog
          sessionCount={sessions.length}
          keyCount={keyCount}
          onClose={() => setShowAbout(false)}
        />
      )}

      {vault && <VaultDialog intent={vault} onClose={() => setVault(null)} />}

      {editing && (
        <SessionDialog
          initial={editing.session}
          onSave={(draft, password) => void saveSession(draft, password)}
          onDelete={(id) => void deleteSession(id)}
          onCancel={() => setEditing(null)}
          onManageKeys={() => setShowKeys(true)}
          onOpenGuide={(focus) => setGuide({ focus })}
        />
      )}

      {showKeys && (
        <KeyManager onClose={() => setShowKeys(false)} onChanged={() => void reloadKeys()} />
      )}

      {queue[0] && (
        <PromptOverlay request={queue[0]} onDone={() => setQueue((current) => current.slice(1))} />
      )}

      {promptDialog}
    </div>
  )
}
