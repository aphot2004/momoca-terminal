import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import type { ConnectOptions, TabState } from '@shared/types'
import { recordInput } from '../macro-recorder'
import { registerTerminal, unregisterTerminal } from '../terminal-registry'
import { broadcastTargets, getView, type PaneRect } from '../view-state'
import { TERMINAL_FONT, terminalThemes, type ThemeName } from '../theme'

interface Props {
  tab: TabState
  /** Where this terminal sits, or null when it isn't on screen. */
  slot: PaneRect | null
  /** True for the tab that receives keyboard focus. */
  focused: boolean
  /** More than one pane is showing, so panes need a visible boundary. */
  split: boolean
  theme: ThemeName
  fontSize: number
  onFocus: () => void
  /** Everything needed to open the backend; read once on mount. */
  connect: Omit<ConnectOptions, 'cols' | 'rows'>
  onTitle: (tabId: string, title: string) => void
  onCwd: (tabId: string, cwd: string) => void
}

export function TerminalPane({
  tab,
  slot,
  focused,
  split,
  theme,
  fontSize,
  onFocus,
  connect,
  onTitle,
  onCwd
}: Props) {
  const visible = slot !== null
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  /** Lines of scrollback below the viewport; 0 means pinned to the newest output. */
  const [behind, setBehind] = useState(0)
  const { tabId } = tab

  // Callbacks live in a ref so the terminal is built exactly once per tab.
  const handlers = useRef({ onTitle, onCwd })
  handlers.current = { onTitle, onCwd }

  // Same for the theme: read at construction, then updated by its own effect.
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: getView().fontSize,
      lineHeight: 1.2,
      theme: terminalThemes[themeRef.current],
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 20_000,
      macOptionIsMeta: true
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon())
    term.open(host)

    // The menu bar acts on the focused terminal — find, save, print — and this
    // instance never reaches React state, so publish it for the whole tab life.
    registerTerminal(tabId, { term, search })

    // WebGL is what keeps a fast `tail -f` smooth, but it fails on some GPUs —
    // fall back silently to the DOM renderer rather than losing the tab.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* DOM renderer it is */
    }

    termRef.current = term
    fitRef.current = fit
    fit.fit()

    // OSC 7 is how a shell announces its working directory; this is what makes
    // the file pane follow `cd`.
    term.parser.registerOscHandler(7, (payload) => {
      const match = /^file:\/\/[^/]*(\/.*)$/.exec(payload)
      if (match) handlers.current.onCwd(tabId, decodeURIComponent(match[1]))
      return true
    })

    term.onTitleChange((title) => handlers.current.onTitle(tabId, title))

    // Track how far back the view is, so the jump-to-bottom chip can appear.
    // xterm already pins to the newest output unless you have scrolled up.
    //
    // Driven by the viewport's own scroll event rather than xterm's onScroll:
    // the latter does not fire for user scrollback (wheel, scrollbar drag), so
    // the chip never appeared. The DOM event fires for every kind of scroll.
    const viewport = host.querySelector<HTMLElement>('.xterm-viewport')
    const updateBehind = () => {
      if (!viewport) return
      const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      if (remaining <= 2) {
        setBehind(0)
        return
      }
      // Convert pixels back to rows using the measured row height, so the chip
      // can say how much is below rather than just "there is more".
      const rowHeight = viewport.clientHeight / Math.max(1, term.rows)
      setBehind(Math.max(1, Math.round(remaining / rowHeight)))
    }
    viewport?.addEventListener('scroll', updateBehind, { passive: true })
    term.onLineFeed(updateBehind)

    // Scrollback keys. Returning false stops xterm forwarding them to the
    // shell, which would otherwise receive a stray escape sequence.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const plainShift = event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
      const plainMeta = event.metaKey && !event.shiftKey && !event.altKey

      if (plainShift || plainMeta) {
        switch (event.key) {
          case 'PageUp':
            term.scrollPages(-1)
            return false
          case 'PageDown':
            term.scrollPages(1)
            return false
          case 'Home':
            term.scrollToTop()
            return false
          case 'End':
            term.scrollToBottom()
            return false
        }
      }

      // ⌘↑ / ⌘↓ page through scrollback, as Terminal.app does. Shift+arrows are
      // left alone because shells use them for selection.
      if (plainMeta && event.key === 'ArrowUp') {
        term.scrollPages(-1)
        return false
      }
      if (plainMeta && event.key === 'ArrowDown') {
        term.scrollPages(1)
        return false
      }

      return true
    })
    term.onData((data) => {
      // Tap the same bytes the backend gets, so a macro records exactly what
      // was typed — control characters included.
      recordInput(tabId, data)
      // With MultiExec on this is every visible terminal, not just this one.
      for (const target of broadcastTargets(tabId)) {
        void window.api.term.write(target, data).catch(() => {})
      }
    })
    term.onResize(({ cols, rows }) => void window.api.term.resize(tabId, cols, rows).catch(() => {}))

    const offData = window.api.term.onData((p) => {
      if (p.tabId === tabId) term.write(p.data)
    })
    const offExit = window.api.term.onExit((p) => {
      if (p.tabId === tabId) term.write('\r\n\x1b[2m[session closed]\x1b[0m\r\n')
    })

    void window.api.term
      .create({ ...connect, tabId, cols: term.cols, rows: term.rows })
      .catch((err: Error) => {
        term.write(`\r\n\x1b[31mConnection failed: ${err.message}\x1b[0m\r\n`)
      })

    const observer = new ResizeObserver(() => {
      // Zero-size while hidden; fitting then would send a bogus 1x1 window.
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      unregisterTerminal(tabId)
      viewport?.removeEventListener('scroll', updateBehind)
      offData()
      offExit()
      void window.api.term.close(tabId).catch(() => {})
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // Recolour live terminals when the user flips the theme.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalThemes[theme]
  }, [theme])

  // Zoom. Refit afterwards, or the shell keeps the old row/column count and
  // full-screen programs draw at the wrong size.
  useEffect(() => {
    const term = termRef.current
    if (!term || term.options.fontSize === fontSize) return
    term.options.fontSize = fontSize
    requestAnimationFrame(() => fitRef.current?.fit())
  }, [fontSize])

  // Re-fit when this pane appears or its slot changes; only the focused pane
  // takes the keyboard, so typing in a split goes where you clicked.
  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      fitRef.current?.fit()
      if (focused) termRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [visible, focused, slot?.top, slot?.left, slot?.width, slot?.height])

  return (
    <div
      className={`terminal-pane${split ? ' in-split' : ''}${split && focused ? ' focused' : ''}`}
      hidden={!visible}
      style={slot ? { top: slot.top, left: slot.left, width: slot.width, height: slot.height } : undefined}
      onMouseDown={onFocus}
      ref={hostRef}
    >
      {split && <div className="pane-label">{tab.title}</div>}
      {behind > 0 && (
        <button
          className="jump-bottom"
          // mouseDown rather than click, and prevented, so focus stays in the
          // terminal instead of jumping to the button.
          onMouseDown={(e) => {
            e.preventDefault()
            termRef.current?.scrollToBottom()
            termRef.current?.focus()
          }}
          title="Scroll to the newest output (⇧End)"
        >
          ↓ {behind.toLocaleString()} line{behind === 1 ? '' : 's'} below
        </button>
      )}
    </div>
  )
}
