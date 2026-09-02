// app/_components/schedule.tsx
'use client'

import Link from 'next/link'

import { cn } from '@app/_lib/cn'
import { formatDuration } from '@app/_lib/format'
import { sessionFill } from '@app/_lib/status'
import type { SessionListItem } from '@app/_lib/types'
import { Badge, Pill } from '@app/_components/ui'

/** Local calendar-day key (YYYY-MM-DD) for grouping a schedule. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface DayGroup {
  key: string
  label: string
  sub: string
  sessions: SessionListItem[]
}

/** Group time-ordered sessions into day sections with Today / Tomorrow labels. */
export function groupByDay(sessions: SessionListItem[], now: Date): DayGroup[] {
  const todayK = dayKey(now.toISOString())
  const tomorrow = new Date(now.getTime() + 86_400_000)
  const tomorrowK = dayKey(tomorrow.toISOString())

  const groups: DayGroup[] = []
  const index = new Map<string, DayGroup>()
  for (const s of sessions) {
    const k = dayKey(s.startsAt)
    let g = index.get(k)
    if (!g) {
      const d = new Date(s.startsAt)
      const weekday = d.toLocaleDateString(undefined, { weekday: 'long' })
      const full = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      g = {
        key: k,
        label: k === todayK ? 'Today' : k === tomorrowK ? 'Tomorrow' : weekday,
        sub: full,
        sessions: [],
      }
      index.set(k, g)
      groups.push(g)
    }
    g.sessions.push(s)
  }
  return groups
}

export function DayHeading({ group }: { group: DayGroup }) {
  return (
    <div className="flex items-baseline gap-2 px-1 py-2">
      <h3 className="text-[0.9375rem] font-semibold text-fg">{group.label}</h3>
      <span className="text-[0.8125rem] text-subtle">{group.sub}</span>
      <span className="ml-auto text-xs text-subtle">
        {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}

/** A single line in the studio schedule: time-first, class-prominent. */
export function ScheduleRow({
  session,
  className,
}: {
  session: SessionListItem
  className?: string
}) {
  const fill = sessionFill(session.bookedCount, session.capacity)
  const durationMin = Math.round(
    (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000,
  )
  const start = new Date(session.startsAt)
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const seatsLeft = session.capacity - session.bookedCount

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:gap-4 sm:px-4',
        className,
      )}
    >
      {/* Time */}
      <div className="w-14 shrink-0 text-right sm:w-16">
        <div className="tabular text-[0.9375rem] leading-tight font-semibold text-fg">{time}</div>
        <div className="text-[0.6875rem] text-subtle">{formatDuration(durationMin)}</div>
      </div>

      {/* Accent rail */}
      <span
        className="h-9 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--tone-${fill.tone})` }}
        aria-hidden="true"
      />

      {/* Class + who/where */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-fg">{session.class.title}</span>
          <Pill className="hidden sm:inline-flex">{session.class.discipline}</Pill>
        </div>
        <div className="mt-0.5 truncate text-[0.8125rem] text-muted">
          {session.room.name} · {session.primaryInstructor.name}
        </div>
      </div>

      {/* Capacity */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular text-[0.8125rem] font-medium text-fg">
          {session.bookedCount}/{session.capacity}
        </span>
        {fill.isFull ? (
          <Badge tone="danger">Full</Badge>
        ) : (
          <span className="text-[0.6875rem] text-subtle">
            {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left
          </span>
        )}
      </div>

      <svg
        viewBox="0 0 16 16"
        className="hidden size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 sm:block"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  )
}
