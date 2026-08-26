import { useState } from 'react'
import { ContextMenu } from './ContextMenu'
import type { MenuDef } from '../menus'

interface Props {
  menus: MenuDef[]
  /** Called when a menu is about to open, so its contents can be refreshed. */
  onOpen?: () => void
}

/**
 * MobaXterm's menu bar: Terminal, Sessions, View, X server, Tools, Macros,
 * Settings, Help. Click a title to open it; with one open, moving across the
 * bar switches menus the way a real menu bar does.
 */
export function MenuBar({ menus, onOpen }: Props) {
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | null>(null)

  const openMenu = (id: string, button: HTMLElement) => {
    const rect = button.getBoundingClientRect()
    onOpen?.()
    setOpen({ id, x: rect.left, y: rect.bottom + 2 })
  }

  const active = open ? menus.find((menu) => menu.id === open.id) : null

  return (
    <div className="menubar" role="menubar">
      {menus.map((menu) => (
        <button
          key={menu.id}
          className={`menubar-item${open?.id === menu.id ? ' open' : ''}`}
          // mousedown rather than click: the open menu's own outside-click
          // handler fires first and would otherwise swallow the second press.
          onMouseDown={(event) => {
            event.preventDefault()
            if (open?.id === menu.id) setOpen(null)
            else openMenu(menu.id, event.currentTarget)
          }}
          onMouseEnter={(event) => {
            if (open && open.id !== menu.id) openMenu(menu.id, event.currentTarget)
          }}
          role="menuitem"
        >
          {menu.label}
        </button>
      ))}

      {active && (
        <ContextMenu
          x={open!.x}
          y={open!.y}
          items={active.items}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
