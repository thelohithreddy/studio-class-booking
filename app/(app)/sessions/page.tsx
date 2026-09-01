'use client'

import { useState } from 'react'
import Link from 'next/link'

import { qk, useApiQuery } from '@app/_lib/query'
import { formatDuration, formatTimeRange } from '@app/_lib/format'
import { sessionFill } from '@app/_lib/status'
import type { ClassListResponse, SessionListItem, SessionListResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  Pill,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '@app/_components/ui'
import { SessionFormDrawer } from '@app/_components/session-forms'
import { IconClock, IconPin, IconPlus, IconSessions, IconUser } from '@app/_components/icons'
import { useIsStaff } from '../_shell/user-context'

export default function SessionsPage() {
  const staff = useIsStaff()
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [scheduling, setScheduling] = useState(false)

  const params = new URLSearchParams({ page: String(page), pageSize: '20' })
  if (classId) params.set('classId', classId)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const sessions = useApiQuery<SessionListResponse>(
    qk.sessions({ classId, from, to, page }),
    `/api/sessions?${params.toString()}`,
  )

  const hasFilters = Boolean(classId || from || to)
  function resetFilters() {
    setClassId('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={staff ? 'Sessions' : 'My sessions'}
        description={
          staff
            ? 'Every scheduled session. Open one to manage bookings, attendance, and instructors.'
            : 'Sessions where you’re the primary instructor or a co-instructor.'
        }
        actions={
          staff ? (
            <Button icon={<IconPlus className="size-4" />} onClick={() => setScheduling(true)}>
              Schedule session
            </Button>
          ) : undefined
        }
      />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {staff ? (
            <ClassFilter
              value={classId}
              onChange={(v) => {
                setClassId(v)
                setPage(1)
              }}
            />
          ) : null}
          <TextInput
            label="From"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            containerClassName="sm:w-40"
          />
          <TextInput
            label="To"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            containerClassName="sm:w-40"
          />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="sm:mb-0.5">
              Clear
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <AsyncBoundary
          query={sessions}
          skeleton={
            <div className="p-4">
              <SkeletonRows rows={6} />
            </div>
          }
          isEmpty={(d) => d.sessions.length === 0}
          empty={
            <EmptyState
              icon={<IconSessions className="size-5" />}
              title={hasFilters ? 'No sessions match these filters' : 'No sessions scheduled'}
              description={
                hasFilters
                  ? 'Try widening the date range or clearing the class filter.'
                  : staff
                    ? 'Schedule a session, or generate a recurring series from a class.'
                    : 'You have no sessions assigned yet.'
              }
              action={
                staff && !hasFilters ? (
                  <Button onClick={() => setScheduling(true)}>Schedule session</Button>
                ) : hasFilters ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {(data) => (
            <>
              <ul className="divide-y divide-line">
                {data.sessions.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </ul>
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </Card>

      {staff ? <SessionFormDrawer open={scheduling} onClose={() => setScheduling(false)} /> : null}
    </div>
  )
}

function ClassFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const classes = useApiQuery<ClassListResponse>(
    qk.classes({ filter: true }),
    '/api/classes?pageSize=100',
  )
  return (
    <SelectInput
      label="Class"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      containerClassName="sm:w-56"
    >
      <option value="">All classes</option>
      {classes.data?.classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </SelectInput>
  )
}

function SessionRow({ session }: { session: SessionListItem }) {
  const fill = sessionFill(session.bookedCount, session.capacity)
  const duration = Math.round(
    (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000,
  )
  return (
    <li>
      <Link
        href={`/sessions/${session.id}`}
        className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex w-14 shrink-0 flex-col items-center rounded-md border border-line bg-surface-2 py-1.5 text-center">
            <span className="text-[0.65rem] font-semibold text-subtle uppercase">
              {new Date(session.startsAt).toLocaleDateString(undefined, { month: 'short' })}
            </span>
            <span className="tabular text-lg leading-none font-semibold text-fg">
              {new Date(session.startsAt).toLocaleDateString(undefined, { day: 'numeric' })}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-fg">{session.class.title}</p>
              <Pill>{session.class.discipline}</Pill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <IconClock className="size-3.5" />
                {formatTimeRange(session.startsAt, session.endsAt)} · {formatDuration(duration)}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconPin className="size-3.5" />
                {session.room.name}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconUser className="size-3.5" />
                {session.primaryInstructor.name}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="tabular text-sm font-medium text-muted">
            {session.bookedCount}/{session.capacity}
          </span>
          <Badge
            tone={fill.tone}
            dot
            title={`${session.bookedCount} of ${session.capacity} spots booked`}
          >
            {fill.label}
          </Badge>
        </div>
      </Link>
    </li>
  )
}
