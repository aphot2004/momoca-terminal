import type { TabState } from '@shared/types'

interface Props {
  tab: TabState | null
  keyCount: number
  sessionCount: number
  /** Transient message, e.g. the result of an external launch or a folder download. */
  notice?: string | null
}

const STATUS_LABEL: Record<TabState['status'], string> = {
  connecting: 'Connecting…',
  ready: 'Connected',
  closed: 'Disconnected',
  error: 'Error'
}

export function StatusBar({ tab, keyCount, sessionCount, notice }: Props) {
  // A notice takes over the line while it lasts — it's the thing just asked for.
  if (notice) {
    return (
      <div className="statusbar">
        <span className="status-dot ready" />
        <span className="status-notice">{notice}</span>
      </div>
    )
  }

  return (
    <div className="statusbar">
      {tab ? (
        <>
          <span className={`status-dot ${tab.status}`} />
          <span>{tab.error ?? STATUS_LABEL[tab.status]}</span>
          <span className="sep">·</span>
          <span>{tab.title}</span>
          {tab.sftp && (
            <>
              <span className="sep">·</span>
              <span>SFTP ready</span>
            </>
          )}
          {tab.cwd && (
            <>
              <span className="sep">·</span>
              <span className="status-cwd">{tab.cwd}</span>
            </>
          )}
        </>
      ) : (
        <span>Ready</span>
      )}

      <span className="status-right">
        {sessionCount} session{sessionCount === 1 ? '' : 's'} · {keyCount} key
        {keyCount === 1 ? '' : 's'}
      </span>
    </div>
  )
}
