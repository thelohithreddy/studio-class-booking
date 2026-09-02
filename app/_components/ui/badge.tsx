// app/_components/ui/badge.tsx
'use client'

import { cn } from '@app/_lib/cn'
import { initials } from '@app/_lib/format'
import type { StatusMeta, Tone } from '@app/_lib/status'

const toneClass: Record<Tone, string> = {
  success: 'tone-success',
  warning: 'tone-warning',
  danger: 'tone-danger',
  info: 'tone-info',
  neutral: 'tone-neutral',
}

export interface BadgeProps {
  tone?: Tone
  /** Show a leading status dot (meaning never rests on color alone, but the dot reinforces it). */
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** A badge driven by a StatusMeta — always renders label + dot together. */
export function StatusBadge({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <Badge tone={meta.tone} dot title={meta.description} className={className}>
      {meta.label}
    </Badge>
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
  const hues = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % hues.length
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `${hues[hash]}22`, color: hues[hash] }}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
