// app/_components/ui/pagination.tsx
'use client'

import { cn } from '@app/_lib/cn'
import { Button } from './button'

/**
 * Server-driven pagination. We know `total`, `page`, and `pageSize` from the API
 * envelope; page count is derived here. Always shows the visible range and total
 * so the operator knows how much data exists beyond the current page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm',
        className,
      )}
    >
      <p className="text-muted">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            <span className="tabular font-medium text-fg">
              {from}–{to}
            </span>{' '}
            of <span className="tabular font-medium text-fg">{total}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className="tabular px-1 text-xs text-muted">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
