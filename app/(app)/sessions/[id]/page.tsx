'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

import { apiSend, downloadFile } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { formatDate, formatDuration, formatTimeRange } from '@app/_lib/format'
import { BOOKING_STATUS, BOOKING_STATUS_ORDER, sessionFill } from '@app/_lib/status'
import type {
  BookingListItem,
  BookingListResponse,
  BookingResponse,
  RosterResponse,
  SessionResponse,
} from '@app/_lib/types'
import {
  AsyncBoundary,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Menu,
  type MenuItem,
  Pill,
  Skeleton,
  StatusBadge,
  Tabs,
  makePanelProps,
  useConfirm,
  useToast,
} from '@app/_components/ui'
import { InstructorPicker } from '@app/_components/pickers'
import { SessionFormDrawer, type EditSessionInit } from '@app/_components/session-forms'
import { BookingCreateDrawer } from '@app/_components/booking-create'
import {
  IconBookings,
  IconDownload,
  IconEdit,
  IconPlus,
  IconTrash,
  IconUser,
} from '@app/_components/icons'
import { useIsStaff } from '../../_shell/user-context'

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const staff = useIsStaff()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()

  const session = useApiQuery<SessionResponse>(qk.session(id), `/api/sessions/${id}`)

  const [tab, setTab] = useState<'bookings' | 'instructors'>('bookings')
  const [editing, setEditing] = useState(false)
  const [booking, setBooking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [now] = useState(() => Date.now())

  async function downloadCsv() {
    setDownloading(true)
    try {
      await downloadFile(`/api/sessions/${id}/attendance`)
      toast.success('Attendance exported')
    } catch (e) {
      toast.error('Export failed', e instanceof Error ? e.message : undefined)
    } finally {
      setDownloading(false)
    }
  }

  const classId = session.data?.session.classId
  const deleteSession = useApiMutation(() => apiSend(`/api/sessions/${id}`, 'DELETE'), {
    // Also refresh the class (its session count) and the class list.
    invalidate: [qk.sessions(), qk.classes(), ...(classId ? [qk.class(classId)] : [])],
    onSuccess: () => {
      toast.success('Session deleted')
      router.replace('/sessions')
    },
    onError: (e) => toast.error('Could not delete session', e.message),
  })

  async function onDelete() {
    const ok = await confirm({
      title: 'Delete this session?',
      description:
        'This permanently removes the session. A session that has ever had a booking can’t be deleted — its booking history is preserved instead.',
      confirmLabel: 'Delete session',
      danger: true,
    })
    if (ok) deleteSession.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <AsyncBoundary
        query={session}
        skeleton={<Skeleton className="h-28 w-full" />}
        forbidden={
          <ErrorState title="Not available" message="You don’t have access to this session." />
        }
      >
        {(data) => {
          const s = data.session
          const started = new Date(s.startsAt).getTime() <= now
          const fill = sessionFill(s.bookedCount, s.capacity)
          const sessionLabel = `${s.class.title} · ${formatDate(s.startsAt)}`
          const editInit: EditSessionInit = {
            id: s.id,
            classId: s.classId,
            classTitle: s.class.title,
            startsAt: s.startsAt,
            durationMinutes: s.durationMinutes,
            capacity: s.capacity,
            primaryInstructorId: s.primaryInstructor.id,
            primaryInstructorName: s.primaryInstructor.name,
            roomId: s.roomId,
            roomName: s.room.name,
          }

          return (
            <>
              <PageHeaderRow
                title={s.class.title}
                discipline={s.class.discipline}
                subtitle={`${formatDate(s.startsAt)} · ${formatTimeRange(s.startsAt, s.endsAt)}`}
                staff={staff}
                onEdit={() => setEditing(true)}
                onAddBooking={() => setBooking(true)}
                onDownload={downloadCsv}
                onDelete={onDelete}
                downloading={downloading}
              />

              <SessionFacts
                room={s.room.name}
                instructor={s.primaryInstructor.name}
                duration={s.durationMinutes}
                booked={s.bookedCount}
                capacity={s.capacity}
                fillTone={fill.tone}
                fillLabel={fill.label}
                fillRatio={fill.ratio}
                started={started}
              />

              <Card className="overflow-hidden">
                <div className="px-4 pt-2 sm:px-5">
                  <Tabs
                    tabs={[
                      { id: 'bookings', label: 'Bookings' },
                      { id: 'instructors', label: 'Instructors' },
                    ]}
                    value={tab}
                    onChange={(t) => setTab(t as 'bookings' | 'instructors')}
                    idBase="session"
                  />
                </div>
                <div {...makePanelProps('session', tab)}>
                  {tab === 'bookings' ? (
                    <BookingsPanel sessionId={id} staff={staff} started={started} />
                  ) : (
                    <InstructorsPanel sessionId={id} staff={staff} />
                  )}
                </div>
              </Card>

              {staff ? (
                <>
                  <SessionFormDrawer
                    open={editing}
                    onClose={() => setEditing(false)}
                    edit={editInit}
                  />
                  <BookingCreateDrawer
                    open={booking}
                    onClose={() => setBooking(false)}
                    fixedSession={{
                      id,
                      label: sessionLabel,
                      capacity: s.capacity,
                      bookedCount: s.bookedCount,
                    }}
                  />
                </>
              ) : null}
            </>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}

function PageHeaderRow({
  title,
  discipline,
  subtitle,
  staff,
  onEdit,
  onAddBooking,
  onDownload,
  onDelete,
  downloading,
}: {
  title: string
  discipline: string
  subtitle: string
  staff: boolean
  onEdit: () => void
  onAddBooking: () => void
  onDownload: () => void
  onDelete: () => void
  downloading: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/sessions"
        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted hover:text-fg"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Sessions
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
            <Pill>{discipline}</Pill>
          </div>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {staff ? (
          <div className="flex items-center gap-2">
            <Button icon={<IconPlus className="size-4" />} onClick={onAddBooking}>
              Add booking
            </Button>
            <Button variant="secondary" icon={<IconEdit className="size-4" />} onClick={onEdit}>
              Edit
            </Button>
            <Menu
              label="More session actions"
              items={[
                {
                  label: downloading ? 'Exporting…' : 'Download attendance CSV',
                  icon: <IconDownload className="size-4" />,
                  onClick: onDownload,
                  disabled: downloading,
                },
                {
                  label: 'Delete session',
                  icon: <IconTrash className="size-4" />,
                  onClick: onDelete,
                  danger: true,
                },
              ]}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SessionFacts({
  room,
  instructor,
  duration,
  booked,
  capacity,
  fillTone,
  fillLabel,
  fillRatio,
  started,
}: {
  room: string
  instructor: string
  duration: number
  booked: number
  capacity: number
  fillTone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  fillLabel: string
  fillRatio: number
  started: boolean
}) {
  return (
    <Card>
      <CardBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Room" value={room} />
        <Fact label="Primary instructor" value={instructor} />
        <Fact label="Duration" value={formatDuration(duration)} />
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Capacity</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="tabular text-sm font-semibold text-fg">
              {booked}/{capacity} booked
            </span>
            <Badge tone={fillTone} dot>
              {fillLabel}
            </Badge>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${Math.round(fillRatio * 100)}%`,
                backgroundColor: `var(--tone-${fillTone})`,
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-subtle">
            {started ? 'Session has started — attendance can be settled.' : 'Upcoming session.'}
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-fg">{value}</p>
    </div>
  )
}

function BookingsPanel({
  sessionId,
  staff,
  started,
}: {
  sessionId: string
  staff: boolean
  started: boolean
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const bookings = useApiQuery<BookingListResponse>(
    qk.bookings({ sessionId }),
    `/api/bookings?sessionId=${sessionId}&pageSize=100&sort=status&dir=asc`,
  )

  const settle = useApiMutation(
    (v: { bookingId: string; status: 'ATTENDED' | 'NO_SHOW' }) =>
      apiSend<BookingResponse>(`/api/bookings/${v.bookingId}/settle`, 'POST', { status: v.status }),
    {
      invalidate: [qk.bookings(), qk.session(sessionId), qk.dashboard],
      onSuccess: (_d, v) =>
        toast.success(v.status === 'ATTENDED' ? 'Marked attended' : 'Marked no-show'),
      onError: (e) => toast.error('Could not update attendance', e.message),
    },
  )

  const cancel = useApiMutation(
    (v: { bookingId: string }) =>
      apiSend<BookingResponse>(`/api/bookings/${v.bookingId}/cancel`, 'POST', {}),
    {
      invalidate: [qk.bookings(), qk.session(sessionId), qk.dashboard],
      onSuccess: () => toast.success('Booking cancelled'),
      onError: (e) => toast.error('Could not cancel booking', e.message),
    },
  )

  async function onCancel(bookingId: string, memberName: string) {
    const ok = await confirm({
      title: `Cancel ${memberName}’s booking?`,
      description:
        'This frees their spot. If they were Booked, the next person on the waitlist is promoted automatically.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      danger: true,
    })
    if (ok) cancel.mutate({ bookingId })
  }

  return (
    <AsyncBoundary
      query={bookings}
      skeleton={
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      }
      isEmpty={(d) => d.bookings.length === 0}
      empty={
        <EmptyState
          icon={<IconBookings className="size-5" />}
          title="No bookings yet"
          description={
            staff
              ? 'Add a booking to reserve a spot for a member. When the session fills, further bookings go to the waitlist.'
              : 'No members have booked this session yet.'
          }
        />
      }
    >
      {(data) => (
        <div>
          <StatusSummary bookings={data.bookings} />
          <ul className="divide-y divide-line">
            {data.bookings.map((b) => (
              <BookingRosterRow
                key={b.id}
                booking={b}
                staff={staff}
                started={started}
                busy={
                  (settle.isPending && settle.variables?.bookingId === b.id) ||
                  (cancel.isPending && cancel.variables?.bookingId === b.id)
                }
                onSettle={(status) => settle.mutate({ bookingId: b.id, status })}
                onCancel={() => onCancel(b.id, b.member.name)}
              />
            ))}
          </ul>
        </div>
      )}
    </AsyncBoundary>
  )
}

function StatusSummary({ bookings }: { bookings: BookingListItem[] }) {
  const counts = BOOKING_STATUS_ORDER.map((status) => ({
    status,
    count: bookings.filter((b) => b.status === status).length,
  })).filter((c) => c.count > 0)
  if (counts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
      {counts.map(({ status, count }) => {
        const meta = BOOKING_STATUS[status]
        return (
          <span key={status} className="inline-flex items-center gap-1.5 text-sm">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: `var(--tone-${meta.tone})` }}
              aria-hidden="true"
            />
            <span className="tabular font-semibold text-fg">{count}</span>
            <span className="text-muted">{meta.label}</span>
          </span>
        )
      })}
    </div>
  )
}

function BookingRosterRow({
  booking,
  staff,
  started,
  busy,
  onSettle,
  onCancel,
}: {
  booking: BookingListItem
  staff: boolean
  started: boolean
  busy: boolean
  onSettle: (status: 'ATTENDED' | 'NO_SHOW') => void
  onCancel: () => void
}) {
  const meta = BOOKING_STATUS[booking.status]
  // Instructors reach this roster only for their own sessions (scoped read), so
  // they may record attendance here; cancelling stays a staff-only action.
  const canSettle = started && booking.status === 'BOOKED'
  const canCancel = staff && (booking.status === 'BOOKED' || booking.status === 'WAITLISTED')

  const items: MenuItem[] = []
  if (canSettle) {
    items.push({ label: 'Mark attended', onClick: () => onSettle('ATTENDED') })
    items.push({ label: 'Mark no-show', onClick: () => onSettle('NO_SHOW') })
  }
  if (canCancel) {
    items.push({ label: 'Cancel booking', onClick: onCancel, danger: true })
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Avatar name={booking.member.name} />
      <div className="min-w-0 flex-1">
        <Link href={`/bookings/${booking.id}`} className="font-medium text-fg hover:text-brand">
          {booking.member.name}
        </Link>
        <p className="text-xs text-subtle">Sign-up #{booking.seq}</p>
      </div>
      {/* Status is always visible (mobile included); quick-settle buttons are an
          added convenience on wider screens, with the same actions in the menu. */}
      <StatusBadge meta={meta} />
      {canSettle ? (
        <div className="hidden items-center gap-1.5 lg:flex">
          <Button variant="secondary" size="sm" onClick={() => onSettle('ATTENDED')} loading={busy}>
            Attended
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSettle('NO_SHOW')} disabled={busy}>
            No-show
          </Button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <Menu label={`Actions for ${booking.member.name}`} items={items} />
      ) : null}
    </li>
  )
}

function InstructorsPanel({ sessionId, staff }: { sessionId: string; staff: boolean }) {
  const toast = useToast()
  const roster = useApiQuery<RosterResponse>(
    qk.roster(sessionId),
    `/api/sessions/${sessionId}/co-instructors`,
  )
  const [addId, setAddId] = useState<string | null>(null)

  const add = useApiMutation(
    (instructorId: string) =>
      apiSend<RosterResponse>(`/api/sessions/${sessionId}/co-instructors`, 'POST', {
        instructorId,
      }),
    {
      invalidate: [qk.roster(sessionId)],
      onSuccess: () => {
        toast.success('Co-instructor added')
        setAddId(null)
      },
      onError: (e) => toast.error('Could not add co-instructor', e.message),
    },
  )
  const remove = useApiMutation(
    (instructorId: string) =>
      apiSend<RosterResponse>(`/api/sessions/${sessionId}/co-instructors`, 'DELETE', {
        instructorId,
      }),
    {
      invalidate: [qk.roster(sessionId)],
      onSuccess: () => toast.success('Co-instructor removed'),
      onError: (e) => toast.error('Could not remove co-instructor', e.message),
    },
  )

  return (
    <div className="p-4 sm:p-5">
      <AsyncBoundary query={roster} skeleton={<Skeleton className="h-32 w-full" />}>
        {(data) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-subtle uppercase">
                Primary instructor
              </p>
              <div className="flex items-center gap-3">
                <Avatar name={data.instructors.primary.name} />
                <span className="font-medium text-fg">{data.instructors.primary.name}</span>
                <Badge tone="info">Primary</Badge>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-subtle uppercase">
                Co-instructors ({data.instructors.coInstructors.length})
              </p>
              {data.instructors.coInstructors.length === 0 ? (
                <p className="text-sm text-muted">
                  No co-instructors. {staff ? 'Add one below.' : ''}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line">
                  {data.instructors.coInstructors.map((ci) => (
                    <li key={ci.id} className="flex items-center gap-3 px-3 py-2.5">
                      <Avatar name={ci.name} />
                      <span className="flex-1 text-sm font-medium text-fg">{ci.name}</span>
                      {staff ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove.mutate(ci.id)}
                          loading={remove.isPending && remove.variables === ci.id}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {staff ? (
              <div className="flex flex-col gap-2 border-t border-line pt-4">
                <p className="text-xs font-medium tracking-wide text-subtle uppercase">
                  Add co-instructor
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <InstructorPicker
                      value={addId}
                      onChange={(v) => setAddId(v)}
                      excludeIds={[
                        data.instructors.primary.id,
                        ...data.instructors.coInstructors.map((ci) => ci.id),
                      ]}
                    />
                  </div>
                  <Button
                    icon={<IconUser className="size-4" />}
                    disabled={!addId}
                    loading={add.isPending}
                    onClick={() => addId && add.mutate(addId)}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
