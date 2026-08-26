import type { SavedSession } from '@shared/types'
import { IconFolderSmall } from './Icons'

interface Props {
  sessions: SavedSession[]
  onOpen: (session: SavedSession) => void
  onEdit: (session: SavedSession) => void
  onNew: () => void
}

/** Groups sessions under their folder label, MobaXterm's sidebar tree in miniature. */
function groupByFolder(sessions: SavedSession[]): [string, SavedSession[]][] {
  const groups = new Map<string, SavedSession[]>()
  for (const session of sessions) {
    const key = session.folder || 'User sessions'
    const bucket = groups.get(key)
    if (bucket) bucket.push(session)
    else groups.set(key, [session])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function SessionSidebar({ sessions, onOpen, onEdit, onNew }: Props) {
  const groups = groupByFolder(sessions)

  return (
    <div className="session-tree">
      {!sessions.length && (
        <div className="muted-row">
          No saved sessions yet.
          <br />
          <button className="linklike" onClick={onNew}>
            Create one
          </button>
        </div>
      )}

      {groups.map(([folder, items]) => (
        <div key={folder} className="tree-group">
          <div className="tree-folder">
            <IconFolderSmall />
            <span>{folder}</span>
          </div>
          {items.map((session) => (
            <button
              key={session.id}
              className="session-row"
              onDoubleClick={() => onOpen(session)}
              onClick={() => onOpen(session)}
              onContextMenu={(e) => {
                e.preventDefault()
                onEdit(session)
              }}
              title={
                session.kind === 'ssh'
                  ? `${session.username}@${session.host}:${session.port ?? 22} — right-click to edit`
                  : 'Local shell — right-click to edit'
              }
            >
              <span className={`kind-dot ${session.kind}`} />
              <span className="sname">{session.name}</span>
              <span className="meta">{session.kind === 'ssh' ? session.host : 'local'}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
