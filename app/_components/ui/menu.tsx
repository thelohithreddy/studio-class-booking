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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    // Move focus to the first item when the menu opens (keyboard entry point).
    const raf = requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus(),
    )
    return () => {
      document.removeEventListener('mousedown', onDoc)
      cancelAnimationFrame(raf)
    }
  }, [open])

  function close(returnFocus = false) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  // Roving focus across menu items (WAI-ARIA menu pattern).
  function onMenuKeyDown(e: React.KeyboardEvent) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        [],
    )
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[Math.min(idx + 1, buttons.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[Math.max(idx - 1, 0)]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      buttons[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      buttons[buttons.length - 1]?.focus()
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close(e.key === 'Escape')
    }
  }

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        ref={triggerRef}
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
          ref={listRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
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
