// app/_components/ui/badge.tsx
'use client'

import { cn } from '@app/_lib/cn'
import { initials } from '@app/_lib/format'
import type { StatusIcon, StatusMeta, Tone } from '@app/_lib/status'

const toneClass: Record<Tone, string> = {
  success: 'tone-success',
  warning: 'tone-warning',
  danger: 'tone-danger',
  info: 'tone-info',
  neutral: 'tone-neutral',
}

/** Small shape glyphs so status reads without color. */
function StatusGlyph({ icon }: { icon: StatusIcon }) {
  const common = { className: 'size-3 shrink-0', 'aria-hidden': true } as const
  if (icon === 'dot')
    return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
  if (icon === 'check')
    return (
      <svg {...common} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (icon === 'clock')
    return (
      <svg {...common} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.75V8l2.25 1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (icon === 'cross')
    return (
      <svg {...common} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
      </svg>
    )
  if (icon === 'alert')
    return (
      <svg {...common} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M8 5v3.5" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="0.35" fill="currentColor" stroke="none" />
        <path d="M8 2 1.5 13.5h13L8 2Z" strokeLinejoin="round" />
      </svg>
    )
  // dash
  return (
    <svg {...common} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h8" strokeLinecap="round" />
    </svg>
  )
}

export interface BadgeProps {
  tone?: Tone
  /** Show a leading status dot. */
  dot?: boolean
  className?: string
  children: React.ReactNode
  title?: string
}

export function Badge({ tone = 'neutral', dot = false, className, children, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** A status chip driven by StatusMeta — icon + label + subtle tone. */
export function StatusBadge({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <span
      title={meta.description}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass[meta.tone],
        className,
      )}
    >
      <StatusGlyph icon={meta.icon} />
      {meta.label}
    </span>
  )
}

/** A neutral pill for counts / metadata (e.g. "12 sessions"). */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Deterministic monogram avatar from a name (no external images). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const hues = ['#b0563a', '#4f7d57', '#a9761f', '#3f6f7a', '#8a5a3c', '#9c4f63']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % hues.length
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `${hues[hash]}1f`, color: hues[hash] }}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
