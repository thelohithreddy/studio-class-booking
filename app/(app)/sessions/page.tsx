'use client'

import { useState } from 'react'
import { keepPreviousData } from '@tanstack/react-query'

import { qk, useApiQuery } from '@app/_lib/query'
import type { ClassListResponse, SessionListResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonRows,
  TextInput,
} from '@app/_components/ui'
import { SessionFormDrawer } from '@app/_components/session-forms'
import { DayHeading, ScheduleRow, groupByDay } from '@app/_components/schedule'
import { IconPlus, IconSessions } from '@app/_components/icons'
import { useIsStaff } from '../_shell/user-context'

export default function SessionsPage() {
  const staff = useIsStaff()
  const [now] = useState(() => new Date())
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [scheduling, setScheduling] = useState(false)

  const params = new URLSearchParams({ page: String(page), pageSize: '30' })
  if (classId) params.set('classId', classId)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const sessions = useApiQuery<SessionListResponse>(
    qk.sessions({ classId, from, to, page }),
    `/api/sessions?${params.toString()}`,
    { placeholderData: keepPreviousData },
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
        title={staff ? 'Schedule' : 'My schedule'}
        description={
          staff
            ? 'Every session, in order. Open one to manage bookings, attendance, and instructors.'
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

      <Card className="p-3 sm:p-3.5">
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

      <AsyncBoundary
        query={sessions}
        skeleton={
          <Card className="p-4">
            <SkeletonRows rows={7} />
          </Card>
        }
        isEmpty={(d) => d.sessions.length === 0}
        empty={
          <Card>
            <EmptyState
              icon={<IconSessions className="size-5" />}
              title={hasFilters ? 'No sessions match these filters' : 'Your schedule is clear'}
              description={
                hasFilters
                  ? 'Try widening the date range or clearing the class filter.'
                  : staff
                    ? 'Schedule a session, or generate a recurring series from a class.'
                    : 'You have no sessions assigned yet.'
              }
              action={
                staff && !hasFilters ? (
                  <Button
                    icon={<IconPlus className="size-4" />}
                    onClick={() => setScheduling(true)}
                  >
                    Schedule session
                  </Button>
                ) : hasFilters ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </Card>
        }
      >
        {(data) => (
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {groupByDay(data.sessions, now).map((group) => (
                <section key={group.key} className="px-2 py-2 sm:px-3">
                  <DayHeading group={group} />
                  <div className="flex flex-col">
                    {group.sessions.map((s) => (
                      <ScheduleRow key={s.id} session={s} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          </Card>
        )}
      </AsyncBoundary>

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
