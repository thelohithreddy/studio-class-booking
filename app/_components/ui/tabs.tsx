// app/_components/ui/tabs.tsx
'use client'

import { useRef } from 'react'

import { cn } from '@app/_lib/cn'

export interface TabItem {
  id: string
  label: string
  count?: number
}

/**
 * Accessible tab strip (WAI-ARIA tablist): roving arrow-key focus, aria-selected,
 * and each tab wired to its panel via id/aria-controls. The caller renders the
 * active panel with role="tabpanel" and the matching id (see makePanelProps).
 */
export function Tabs({
  tabs,
  value,
  onChange,
  idBase = 'tab',
  className,
}: {
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  idBase?: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.id === value)
    if (idx < 0) return
    let next = idx
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    const target = tabs[next]
    if (!target) return
    onChange(target.id)
    refs.current[target.id]?.focus()
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            role="tab"
            id={`${idBase}-${tab.id}`}
            aria-selected={active}
            aria-controls={`${idBase}-${tab.id}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active
                ? 'border-brand text-fg'
                : 'border-transparent text-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 py-0.5 text-xs font-semibold',
                  active ? 'bg-brand-subtle text-brand-subtle-fg' : 'bg-surface-2 text-muted',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Props to spread onto the active panel container for correct tab semantics. */
export function makePanelProps(idBase: string, id: string) {
  return {
    role: 'tabpanel',
    id: `${idBase}-${id}-panel`,
    'aria-labelledby': `${idBase}-${id}`,
    tabIndex: 0,
  } as const
}
