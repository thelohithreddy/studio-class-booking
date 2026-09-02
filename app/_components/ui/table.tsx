// app/_components/ui/table.tsx
'use client'

import { cn } from '@app/_lib/cn'

/**
 * Scannable data table. The wrapper scrolls horizontally on its own so the page
 * body never does; on narrow screens callers can swap to a card list instead of
 * shrinking columns to nothing (see the bookings/members mobile layouts).
 */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line">
      <tr>{children}</tr>
    </thead>
  )
}

type Align = 'left' | 'right' | 'center'
const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function Th({
  children,
  align = 'left',
  className,
  sortable,
  active,
  direction,
  onSort,
  scope = 'col',
}: {
  children?: React.ReactNode
  align?: Align
  className?: string
  sortable?: boolean
  active?: boolean
  direction?: 'asc' | 'desc'
  onSort?: () => void
  scope?: string
}) {
  const inner = (
    <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
      {children}
      {sortable ? (
        <svg
          viewBox="0 0 16 16"
          className={cn(
            'size-3 transition-transform',
            active ? 'opacity-100' : 'opacity-30',
            active && direction === 'asc' && 'rotate-180',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M8 3v10M4 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  )
  return (
    <th
      scope={scope}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-subtle uppercase',
        alignClass[align],
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
    </th>
  )
}

export function Tr({
  children,
  className,
  onClick,
  href,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  href?: string
}) {
  const interactive = Boolean(onClick || href)
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-line last:border-0',
        interactive && 'cursor-pointer transition-colors hover:bg-surface-2/60',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: React.ReactNode
  align?: Align
  className?: string
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn('px-4 py-3.5 align-middle text-fg', alignClass[align], className)}
    >
      {children}
    </td>
  )
}
