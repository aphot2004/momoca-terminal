import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  /** A separator when neither `label` nor `heading` is present. */
  label?: string
  /** A non-clickable section title, the way MobaXterm groups its Tools menu. */
  heading?: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  /** Right-aligned hint, e.g. a shortcut. */
  hint?: string
  /** Ticked state. Items in a menu that has any tick share a check column. */
  checked?: boolean
  /** Nested menu, opened on hover or click. */
  submenu?: MenuItem[]
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /**
   * Called instead of `onClose` when an item is actually chosen. A submenu uses
   * it to dismiss the whole chain while its own `onClose` only collapses itself
   * — otherwise moving back to the parent menu would tear everything down
   * before the click landed.
   */
  onActivate?: () => void
}

export function ContextMenu({ x, y, items, onClose, onActivate }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  /** Index of the open submenu, plus where to hang it. */
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)

  const dismiss = onActivate ?? onClose
  const checkColumn = items.some((item) => item.checked)

  // Flip the menu back inside the window when it would overhang an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: x + width > window.innerWidth ? Math.max(4, window.innerWidth - width - 4) : x,
      top: y + height > window.innerHeight ? Math.max(4, window.innerHeight - height - 4) : y
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Capture phase so a click anywhere dismisses before it activates something.
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      className={`ctx-menu${checkColumn ? ' ticked' : ''}`}
      ref={ref}
      style={pos}
      role="menu"
    >
      {items.map((item, index) => {
        if (item.heading !== undefined) {
          return (
            <div key={index} className="ctx-heading">
              {item.heading}
            </div>
          )
        }
        if (item.label === undefined) return <div key={index} className="ctx-sep" />

        const hasSub = Boolean(item.submenu?.length)
        return (
          <button
            key={index}
            className={`ctx-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
            disabled={item.disabled}
            onMouseEnter={(event) => {
              if (!hasSub || item.disabled) {
                setSub(null)
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              setSub({ index, x: rect.right - 3, y: rect.top - 5 })
            }}
            onClick={() => {
              if (hasSub) return
              dismiss()
              item.onClick?.()
            }}
            role="menuitem"
          >
            {checkColumn && <span className="ctx-tick">{item.checked ? '✓' : ''}</span>}
            <span>{item.label}</span>
            {item.hint && <span className="ctx-hint">{item.hint}</span>}
            {hasSub && <span className="ctx-arrow">›</span>}
          </button>
        )
      })}

      {/*
        Rendered inside this menu's own element so a click in the submenu does
        not read as a click outside the parent, which would close both.
      */}
      {sub && items[sub.index]?.submenu && (
        <ContextMenu
          x={sub.x}
          y={sub.y}
          items={items[sub.index].submenu!}
          onClose={() => setSub(null)}
          onActivate={dismiss}
        />
      )}
    </div>
  )
}
