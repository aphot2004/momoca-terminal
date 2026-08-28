import { useEffect } from 'react'

/**
 * Escape closes the dialog on top.
 *
 * Every modal binding its own `keydown` listener would mean one Escape closes
 * the whole stack at once — press it inside the macro editor and both the
 * editor and the macro manager behind it vanish. So handlers go on a stack and
 * only the last one registered hears the key. `ContextMenu` keeps its own
 * listener for the same reason: menus nest inside menus, and each level tracks
 * its own submenu.
 *
 * A dialog that something is *waiting on* — an auth prompt, a host-key
 * decision — passes the handler that declines properly rather than one that
 * merely unmounts, or the main process is left waiting for a reply that never
 * comes.
 */
const stack: (() => void)[] = []

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || stack.length === 0) return
  // A composing IME uses Escape to abandon its candidate; that is not ours.
  if (event.isComposing) return
  event.stopPropagation()
  stack[stack.length - 1]()
}

export function useEscape(onEscape: (() => void) | null): void {
  useEffect(() => {
    if (!onEscape) return

    if (stack.length === 0) {
      window.addEventListener('keydown', onKeyDown, true)
    }
    stack.push(onEscape)

    return () => {
      const at = stack.lastIndexOf(onEscape)
      if (at !== -1) stack.splice(at, 1)
      if (stack.length === 0) {
        window.removeEventListener('keydown', onKeyDown, true)
      }
    }
  }, [onEscape])
}
