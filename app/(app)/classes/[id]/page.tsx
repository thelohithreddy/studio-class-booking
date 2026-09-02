'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { keepPreviousData } from '@tanstack/react-query'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { formatDate, formatDateTime, formatDuration, formatTime, pluralize } from '@app/_lib/format'
import { classState, sessionFill } from '@app/_lib/status'
import type {
  ClassDetailResponse,
  ClassResponse,
  SessionListItem,
  SessionListResponse,
} from '@app/_lib/types'
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataRow,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Pill,
  Skeleton,
  StatusBadge,
  useConfirm,
  useToast,
} from '@app/_components/ui'
import { ClassFormDrawer } from '@app/_components/class-form'
import { GenerateDrawer, SessionFormDrawer } from '@app/_components/session-forms'
import { IconArchive, IconEdit, IconPlus, IconRepeat, IconSessions } from '@app/_components/icons'

export default function ClassDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const toast = useToast()
  const confirm = useConfirm()

  const cls = useApiQuery<ClassDetailResponse>(qk.class(id), `/api/classes/${id}`)
  const [sessionPage, setSessionPage] = useState(1)
  const sessions = useApiQuery<SessionListResponse>(
    qk.sessions({ classId: id, page: sessionPage }),
    `/api/sessions?classId=${id}&page=${sessionPage}&pageSize=10`,
    { placeholderData: keepPreviousData },
  )

  const [editing, setEditing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [generating, setGenerating] = useState(false)

  const archived = cls.data?.class.archivedAt ?? null
  const isArchived = archived !== null

  const archiveToggle = useApiMutation(
    () =>
      apiSend<ClassResponse>(`/api/classes/${id}/${isArchived ? 'restore' : 'archive'}`, 'POST'),
    {
      invalidate: [qk.classes(), qk.class(id)],
      onSuccess: () => toast.success(isArchived ? 'Class restored' : 'Class archived'),
      onError: (e) => toast.error('Could not update class', e.message),
    },
  )

  async function toggleArchive() {
    if (!isArchived) {
      const ok = await confirm({
        title: `Archive this class?`,
        description:
          'It will be hidden from default views. Existing sessions and bookings are kept, and you can restore it anytime.',
        confirmLabel: 'Archive class',
      })
      if (!ok) return
    }
    archiveToggle.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <AsyncBoundary
        query={cls}
        skeleton={<Skeleton className="h-24 w-full" />}
        forbidden={
          <ErrorState title="Not available" message="You don’t have access to this class." />
        }
      >
        {(data) => {
          const c = data.class
          return (
            <>
              <PageHeader
                back={{ href: '/classes', label: 'All classes' }}
                title={
                  <span className="flex items-center gap-3">
                    {c.title}
                    <StatusBadge meta={classState(c.archivedAt)} />
                  </span>
                }
                description={c.description || undefined}
                actions={
                  <>
                    <Button
                      variant="secondary"
                      icon={<IconEdit className="size-4" />}
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      icon={<IconArchive className="size-4" />}
                      onClick={toggleArchive}
                      loading={archiveToggle.isPending}
                    >
                      {isArchived ? 'Restore' : 'Archive'}
                    </Button>
                  </>
                }
              />

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader title="Details" />
                  <CardBody className="py-2">
                    <dl className="divide-y divide-line">
                      <DataRow label="Discipline">
                        <Pill>{c.discipline}</Pill>
                      </DataRow>
                      <DataRow label="Default duration">
                        {formatDuration(c.defaultDurationMinutes)}
                      </DataRow>
                      <DataRow label="Default capacity">
                        {pluralize(c.defaultCapacity, 'spot')}
                      </DataRow>
                      <DataRow label="Sessions">{c._count.sessions}</DataRow>
                      <DataRow label="Created">{formatDate(c.createdAt)}</DataRow>
                    </dl>
                  </CardBody>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader
                    title="Sessions"
                    description="Every session scheduled from this class."
                    actions={
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<IconRepeat className="size-4" />}
                          onClick={() => setGenerating(true)}
                          disabled={isArchived}
                          title={isArchived ? 'Restore the class to schedule sessions' : undefined}
                        >
                          Generate
                        </Button>
                        <Button
                          size="sm"
                          icon={<IconPlus className="size-4" />}
                          onClick={() => setScheduling(true)}
                          disabled={isArchived}
                          title={isArchived ? 'Restore the class to schedule sessions' : undefined}
                        >
                          Schedule
                        </Button>
                      </div>
                    }
                  />
                  <ClassSessions
                    query={sessions}
                    onSchedule={() => setScheduling(true)}
                    onPageChange={setSessionPage}
                    canSchedule={!isArchived}
                  />
                </Card>
              </div>

              <ClassFormDrawer open={editing} onClose={() => setEditing(false)} cls={c} />
              <SessionFormDrawer
                open={scheduling}
                onClose={() => setScheduling(false)}
                fixedClassId={id}
              />
              <GenerateDrawer open={generating} onClose={() => setGenerating(false)} classId={id} />
            </>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}

function ClassSessions({
  query,
  onSchedule,
  onPageChange,
  canSchedule,
}: {
  query: ReturnType<typeof useApiQuery<SessionListResponse>>
  onSchedule: () => void
  onPageChange: (page: number) => void
  canSchedule: boolean
}) {
  return (
    <AsyncBoundary
      query={query}
      skeleton={
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      }
      isEmpty={(d) => d.sessions.length === 0}
      empty={
        <EmptyState
          icon={<IconSessions className="size-5" />}
          title="No sessions scheduled"
          description="Schedule a one-off session or generate a recurring weekly pattern to fill the calendar."
          action={
            canSchedule ? (
              <Button size="sm" onClick={onSchedule}>
                Schedule a session
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
              <ClassSessionRow key={s.id} session={s} />
            ))}
          </ul>
          {data.total > data.pageSize ? (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={onPageChange}
            />
          ) : null}
        </>
      )}
    </AsyncBoundary>
  )
}

function ClassSessionRow({ session }: { session: SessionListItem }) {
  const fill = sessionFill(session.bookedCount, session.capacity)
  return (
    <li>
      <Link
        href={`/sessions/${session.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-md border border-line bg-surface-2 text-center leading-none">
          <span className="text-[0.6rem] font-semibold text-subtle uppercase">
            {new Date(session.startsAt).toLocaleDateString(undefined, { month: 'short' })}
          </span>
          <span className="tabular text-base font-semibold text-fg">
            {new Date(session.startsAt).toLocaleDateString(undefined, { day: 'numeric' })}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">{formatDateTime(session.startsAt)}</p>
          <p className="truncate text-xs text-muted">
            {formatTime(session.startsAt)}–{formatTime(session.endsAt)} · {session.room.name} ·{' '}
            {session.primaryInstructor.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular text-xs font-medium text-muted">
            {session.bookedCount}/{session.capacity}
          </span>
          <Badge
            tone={fill.tone}
            dot
            title={`${session.bookedCount} of ${session.capacity} booked`}
          >
            {fill.label}
          </Badge>
        </div>
      </Link>
    </li>
  )
}
