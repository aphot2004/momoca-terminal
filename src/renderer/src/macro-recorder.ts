import { useSyncExternalStore } from 'react'
import type { MacroStep } from '@shared/types'

/**
 * Captures what you type into a terminal so it can be replayed.
 *
 * Recording taps the same stream that goes to the backend, i.e. the raw bytes
 * xterm produces — so control characters, arrow keys and escape sequences
 * replay exactly as typed rather than being reconstructed from a transcript.
 * Deliberately *not* recorded: terminal output, which would be meaningless to
 * send back to a shell.
 */
interface RecorderState {
  recording: boolean
  /** Tab being recorded, so input from other tabs is ignored. */
  tabId: string | null
  steps: MacroStep[]
}

let state: RecorderState = { recording: false, tabId: null, steps: [] }
let lastAt = 0
const listeners = new Set<() => void>()

function emit(next: RecorderState): void {
  state = next
  for (const listener of listeners) listener()
}

export function startRecording(tabId: string): void {
  lastAt = Date.now()
  emit({ recording: true, tabId, steps: [] })
}

export function stopRecording(): MacroStep[] {
  const steps = state.steps
  emit({ recording: false, tabId: null, steps })
  return steps
}

export function discardRecording(): void {
  emit({ recording: false, tabId: null, steps: [] })
}

/** Called by TerminalPane for every keystroke it forwards to the backend. */
export function recordInput(tabId: string, data: string): void {
  if (!state.recording || state.tabId !== tabId) return

  const now = Date.now()
  const delay = lastAt ? now - lastAt : 0
  lastAt = now

  // Typing one character at a time would make thousands of steps; merge runs of
  // plain text that arrive close together, but keep control bytes separate so
  // Enter and friends stay visible when editing a macro.
  const isPlain = !/[\x00-\x1f\x7f]/.test(data)
  const previous = state.steps[state.steps.length - 1]

  if (isPlain && previous && delay < 400 && !/[\x00-\x1f\x7f]/.test(previous.data)) {
    const steps = state.steps.slice(0, -1)
    steps.push({ data: previous.data + data, delay: previous.delay })
    emit({ ...state, steps })
    return
  }

  emit({ ...state, steps: [...state.steps, { data, delay: Math.min(delay, 5000) }] })
}

export function useRecorder(): RecorderState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}

/** Resolve a macro's effective speed, honouring the old boolean field. */
export function macroSpeed(macro: { speed?: number; useRecordedTiming?: boolean }): number {
  if (typeof macro.speed === 'number') return macro.speed
  return macro.useRecordedTiming ? 1 : 0
}

/**
 * Replay a macro into one tab.
 *
 * `speed` scales the recorded pauses; 0 means go as fast as the shell will
 * take it. Even then a token gap remains, because a remote shell's line
 * discipline will otherwise coalesce separate commands into one line.
 */
export async function playMacro(
  tabId: string,
  steps: MacroStep[],
  speed: number,
  shouldStop: () => boolean = () => false
): Promise<void> {
  for (const step of steps) {
    if (shouldStop()) return
    const wait = speed > 0 ? step.delay / speed : Math.min(step.delay, 15)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (shouldStop()) return
    await window.api.term.write(tabId, step.data)
  }
}

/**
 * Replay into several terminals at once — MobaXterm's MultiExec, applied to a
 * saved macro. Runs are concurrent so the tabs stay in step with each other,
 * and one failing target does not abort the rest.
 */
export async function playMacroOnTargets(
  tabIds: string[],
  steps: MacroStep[],
  speed: number,
  shouldStop: () => boolean = () => false
): Promise<{ tabId: string; error?: string }[]> {
  return Promise.all(
    tabIds.map(async (tabId) => {
      try {
        await playMacro(tabId, steps, speed, shouldStop)
        return { tabId }
      } catch (err) {
        return { tabId, error: err instanceof Error ? err.message : String(err) }
      }
    })
  )
}

/**
 * Escape recorded bytes into something editable by hand, and back again.
 * Round-trips exactly, so editing a macro cannot silently corrupt a control
 * character that was faithfully recorded.
 */
export function encodeData(data: string): string {
  let out = ''
  for (const char of data) {
    const code = char.charCodeAt(0)
    if (char === '\\') out += '\\\\'
    else if (char === '\r') out += '\\r'
    else if (char === '\n') out += '\\n'
    else if (char === '\t') out += '\\t'
    else if (code === 27) out += '\\e'
    else if (code < 32 || code === 127) out += '\\x' + code.toString(16).padStart(2, '0')
    else out += char
  }
  return out
}

export function decodeData(text: string): string {
  return text.replace(/\\(\\|r|n|t|e|x[0-9a-fA-F]{2})/g, (_match, escape: string) => {
    switch (escape) {
      case '\\':
        return '\\'
      case 'r':
        return '\r'
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'e':
        return String.fromCharCode(27)
      default:
        return String.fromCharCode(parseInt(escape.slice(1), 16))
    }
  })
}

/** Human-readable form of recorded bytes, for the macro list and editor. */
export function describeSteps(steps: MacroStep[]): string {
  return steps
    .map((s) => s.data)
    .join('')
    .replace(/\r/g, '⏎')
    .replace(/\n/g, '⏎')
    .replace(/\t/g, '⇥')
    .replace(/\x03/g, '^C')
    .replace(/\x04/g, '^D')
    .replace(/\x1b/g, '␛')
    .replace(/[\x00-\x1f\x7f]/g, '·')
}
