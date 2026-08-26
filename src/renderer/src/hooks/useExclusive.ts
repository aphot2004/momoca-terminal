import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Clicks that arrive while a modal is up are queued by the renderer and
 * delivered the instant it closes. Without a tail, those replayed clicks
 * immediately reopen the dialog — which is precisely the "it pops up over and
 * over" behaviour. Staying locked briefly after the action swallows them.
 */
const DEFAULT_COOLDOWN_MS = 500

/**
 * Runs one async action at a time, dropping re-entrant calls and anything that
 * arrives during the cooldown that follows.
 *
 * The guard is a ref, not the `busy` state, because state updates are batched:
 * a double-click delivers both events before React re-renders, so a
 * state-based check would let the second one through and stack a second dialog
 * behind the first. The ref flips synchronously.
 *
 * `busy` is returned for disabling controls; it stays true through the cooldown
 * so the button visibly refuses rather than looking clickable but doing nothing.
 */
export function useExclusive(cooldownMs = DEFAULT_COOLDOWN_MS): {
  busy: boolean
  run: (action: () => Promise<unknown> | unknown) => Promise<void>
} {
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const run = useCallback(
    async (action: () => Promise<unknown> | unknown) => {
      if (running.current) return
      running.current = true
      setBusy(true)
      try {
        await action()
      } finally {
        if (cooldownMs > 0) {
          timer.current = setTimeout(() => {
            running.current = false
            if (mounted.current) setBusy(false)
          }, cooldownMs)
        } else {
          running.current = false
          if (mounted.current) setBusy(false)
        }
      }
    },
    [cooldownMs]
  )

  return { busy, run }
}
