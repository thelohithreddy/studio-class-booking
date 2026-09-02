// app/_components/ui/page.tsx
'use client'

import Link from 'next/link'

import { cn } from '@app/_lib/cn'

/** A consistent page header: optional back link, title, subtitle, actions. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: string }
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted hover:text-fg"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-[1.45rem] tracking-tight text-fg sm:text-[1.7rem]">
            {title}
          </h1>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

/** A labeled content section within a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {title ? <h2 className="text-sm font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
