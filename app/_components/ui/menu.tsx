// app/_components/ui/menu.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@app/_lib/cn'
import { IconButton } from './button'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * A small dropdown menu for secondary/row actions — progressive disclosure so a
 * row or header isn't a wall of buttons. Closes on select, outside click, or
 * Escape. The default trigger is an accessible icon button (kebab).
 */
export function Menu({
  items,
  label = 'Actions',
  align = 'right',
}: {
  items: MenuItem[]
  label?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        label={label}
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 20 20" className="size-4.5" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </IconButton>
      {open ? (
        <ul
          role="menu"
          className={cn(
            'anim-pop-in absolute z-30 mt-1 min-w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => (
            <li key={i} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                  item.danger
                    ? 'text-[color:var(--tone-danger)] hover:bg-[var(--tone-danger-bg)]'
                    : 'text-fg hover:bg-surface-2',
                )}
              >
                {item.icon ? <span className="shrink-0 text-subtle">{item.icon}</span> : null}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
