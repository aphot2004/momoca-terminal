import { useState } from 'react'
import type { SavedSession, TabState } from '@shared/types'
import { FileBrowser } from './FileBrowser'
import { SessionSidebar } from './SessionSidebar'

export type PanelTab = 'sessions' | 'sftp'

interface Props {
  sessions: SavedSession[]
  activeTab: TabState | null
  panel: PanelTab
  onPanel: (panel: PanelTab) => void
  onOpen: (session: SavedSession) => void
  onEdit: (session: SavedSession) => void
  onNew: () => void
  onQuickConnect: (target: string) => void
}

export function LeftPanel({
  sessions,
  activeTab,
  panel,
  onPanel,
  onOpen,
  onEdit,
  onNew,
  onQuickConnect
}: Props) {
  const [quick, setQuick] = useState('')
  const sftpReady = Boolean(activeTab?.sftp) && activeTab?.status !== 'closed'
  // Fall back to the tree when the active tab can't offer a file browser.
  const showing: PanelTab = panel === 'sftp' && sftpReady ? 'sftp' : 'sessions'

  return (
    <aside className="sidebar">
      {/* Empty strip: the macOS traffic lights sit here, so nothing else can. */}
      <div className="sidebar-head" />

      <form
        className="quick-connect"
        onSubmit={(e) => {
          e.preventDefault()
          const target = quick.trim()
          if (!target) return
          onQuickConnect(target)
          setQuick('')
        }}
      >
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Quick connect…"
          title="user@host or user@host:port, then Enter"
          spellCheck={false}
        />
      </form>

      <div className="panel-tabs">
        <button
          className={`panel-tab${showing === 'sessions' ? ' active' : ''}`}
          onClick={() => onPanel('sessions')}
        >
          Sessions
        </button>
        <button
          className={`panel-tab${showing === 'sftp' ? ' active' : ''}`}
          onClick={() => onPanel('sftp')}
          disabled={!sftpReady}
          title={sftpReady ? 'Browse files over SFTP' : 'Open an SSH session to browse files'}
        >
          SFTP
        </button>
      </div>

      {showing === 'sftp' && activeTab ? (
        // Keyed by tab so switching sessions resets the browser's state.
        <FileBrowser key={activeTab.tabId} tabId={activeTab.tabId} cwd={activeTab.cwd} />
      ) : (
        <SessionSidebar sessions={sessions} onOpen={onOpen} onEdit={onEdit} onNew={onNew} />
      )}

      <div className="sidebar-actions">
        <button className="btn primary" onClick={onNew}>
          New Session
        </button>
      </div>
    </aside>
  )
}
