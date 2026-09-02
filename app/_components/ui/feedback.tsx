// app/_components/ui/feedback.tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { UseQueryResult } from '@tanstack/react-query'

import { cn } from '@app/_lib/cn'
import { ApiError } from '@app/_lib/api'
import type { Tone } from '@app/_lib/status'
import { Button } from './button'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-5 animate-spin rounded-full border-2 border-line-strong border-r-transparent',
        className,
      )}
    />
  )
}

/** A single shimmer block. Give it width/height via className. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-md', className)} />
}

/** A stack of skeleton rows, layout-preserving while a list loads. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

const iconWrap =
  'flex size-11 items-center justify-center rounded-full border border-line bg-surface-2 text-muted'

/**
 * Empty state — never a bare "No data." Says what is empty, why it matters, and
 * (optionally) the next action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className={iconWrap}>{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/** Error state with a retry — the message comes from the server when we have it. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div className={cn(iconWrap, 'tone-danger border-current/20')}>
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 8v5" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.4" fill="currentColor" stroke="none" />
          <path d="M12 3 2 20h20L12 3Z" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {message ? <p className="mx-auto max-w-sm text-sm text-muted">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

const calloutTone: Record<Tone, string> = {
  success: 'tone-success',
  warning: 'tone-warning',
  danger: 'tone-danger',
  info: 'tone-info',
  neutral: 'tone-neutral',
}

/** An inline banner for contextual guidance or a non-fatal result. */
export function Callout({
  tone = 'info',
  title,
  children,
  className,
  role,
}: {
  tone?: Tone
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
  role?: string
}) {
  return (
    <div
      role={role}
      className={cn('rounded-lg border px-3.5 py-3 text-sm', calloutTone[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? (
        <div className={cn(title ? 'mt-0.5' : undefined, 'text-current/90')}>{children}</div>
      ) : null}
    </div>
  )
}

/**
 * Bridges a React Query result to the loading / error / empty / ready states,
 * so every page handles them identically. A 401 sends the user to /login; a 403
 * renders `forbidden` when provided (e.g. an instructor on a staff-only view).
 */
export function AsyncBoundary<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  forbidden,
  children,
}: {
  query: UseQueryResult<T, Error>
  skeleton?: React.ReactNode
  empty?: React.ReactNode
  isEmpty?: (data: T) => boolean
  forbidden?: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  const router = useRouter()
  const err = query.error
  const status = err instanceof ApiError ? err.status : undefined

  useEffect(() => {
    if (status === 401) router.replace('/login')
  }, [status, router])

  if (query.isPending) return <>{skeleton ?? <SkeletonRows />}</>

  if (query.isError) {
    if (status === 401) return <SkeletonRows />
    if (status === 403 && forbidden !== undefined) return <>{forbidden}</>
    return <ErrorState message={err?.message} onRetry={() => void query.refetch()} />
  }

  const data = query.data as T
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>
  return <>{children(data)}</>
}
