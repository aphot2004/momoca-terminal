import type { TabState } from '@shared/types'
import { useView } from '../view-state'

interface Props {
  /** Shown only in compact mode, where the ribbon's View button is hidden. */
  compactView?: (x: number, y: number) => void
  tabs: TabState[]
  activeId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, compactView }: Props) {
  const { tabNumbers, tabClose } = useView()

  return (
    <div className="tabbar">
      {tabs.map((tab, index) => (
        <div
          key={tab.tabId}
          className={`tab${tab.tabId === activeId ? ' active' : ''}`}
          onMouseDown={(e) => {
            // Middle-click closes, matching every other tabbed app.
            if (e.button === 1) onClose(tab.tabId)
            else onSelect(tab.tabId)
          }}
          title={tab.error ?? tab.title}
        >
          <span className={`dot ${tab.status}`} />
          {tabNumbers && index < 9 && <span className="tab-number">{index + 1}</span>}
          <span className="label">{tab.title}</span>
          {tabClose && (
            <button
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.tabId)
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button className="new-tab" onClick={onNew} title="New local terminal (⌘T)">
        +
      </button>

      {compactView && (
        <button
          className="new-tab compact-view"
          onClick={(e) => compactView(e.clientX, e.clientY)}
          title="View options — the ribbon is hidden in compact mode"
        >
          ⌄
        </button>
      )}
    </div>
  )
}
