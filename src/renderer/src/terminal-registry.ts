import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'

/**
 * The live xterm instance behind each tab.
 *
 * Menu items — find, save the transcript, print it — need to reach the terminal
 * that a tab owns, but a TerminalPane mounts exactly once and must never be
 * re-parented, so the instance cannot be lifted into React state. Each pane
 * registers itself here on mount and drops out on dispose.
 */
interface Entry {
  term: Terminal
  search: SearchAddon
}

const entries = new Map<string, Entry>()

export function registerTerminal(tabId: string, entry: Entry): void {
  entries.set(tabId, entry)
}

export function unregisterTerminal(tabId: string): void {
  entries.delete(tabId)
}

export function getTerminal(tabId: string | null): Entry | null {
  return tabId ? (entries.get(tabId) ?? null) : null
}

/** The whole scrollback as plain text, trailing blank lines trimmed. */
export function terminalText(tabId: string | null): string {
  const entry = getTerminal(tabId)
  if (!entry) return ''
  const { buffer } = entry.term
  const lines: string[] = []
  for (let i = 0; i < buffer.active.length; i++) {
    lines.push(buffer.active.getLine(i)?.translateToString(true) ?? '')
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.join('\n')
}

/** Search state, so "Find next" can repeat the last term. */
let lastQuery = ''

export function findInTerminal(tabId: string | null, query: string): boolean {
  const entry = getTerminal(tabId)
  if (!entry || !query) return false
  lastQuery = query
  return entry.search.findNext(query, { incremental: false })
}

export function findNextInTerminal(tabId: string | null): boolean {
  return lastQuery ? findInTerminal(tabId, lastQuery) : false
}

export function lastSearch(): string {
  return lastQuery
}

export function focusTerminal(tabId: string | null): void {
  getTerminal(tabId)?.term.focus()
}
