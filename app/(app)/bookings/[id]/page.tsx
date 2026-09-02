'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { formatDate, formatDateTime } from '@app/_lib/format'
import { useResetOnOpen } from '@app/_lib/use-reset-on-open'
import { BOOKING_STATUS, type Tone } from '@app/_lib/status'
import type {
  BookingDetail,
  BookingDetailResponse,
  BookingEvent,
  BookingResponse,
} from '@app/_lib/types'
import {
  AsyncBoundary,
  Avatar,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DataRow,
  Dialog,
  ErrorState,
  Skeleton,
  StatusBadge,
  TextArea,
  useConfirm,
  useToast,
} from '@app/_components/ui'
import { useIsStaff } from '../../_shell/user-context'

export default function BookingDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const staff = useIsStaff()
  const toast = useToast()
  const confirm = useConfirm()

  const booking = useApiQuery<BookingDetailResponse>(qk.booking(id), `/api/bookings/${id}`)
  const [noteOpen, setNoteOpen] = useState(false)
  const [now] = useState(() => Date.now())

  const settle = useApiMutation(
    (status: 'ATTENDED' | 'NO_SHOW') =>
      apiSend<BookingResponse>(`/api/bookings/${id}/settle`, 'POST', { status }),
    {
      invalidate: [qk.booking(id), qk.bookings(), qk.dashboard],
      onSuccess: (_d, status) =>
        toast.success(status === 'ATTENDED' ? 'Marked attended' : 'Marked no-show'),
      onError: (e) => toast.error('Could not settle booking', e.message),
    },
  )
  const cancel = useApiMutation(
    () => apiSend<BookingResponse>(`/api/bookings/${id}/cancel`, 'POST', {}),
    {
      invalidate: [qk.booking(id), qk.bookings(), qk.dashboard],
      onSuccess: () => toast.success('Booking cancelled'),
      onError: (e) => toast.error('Could not cancel booking', e.message),
    },
  )

  async function onCancel(memberName: string) {
    const ok = await confirm({
      title: `Cancel ${memberName}’s booking?`,
      description:
        'This frees their spot. If they were Booked, the next waitlisted member is promoted automatically.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      danger: true,
    })
    if (ok) cancel.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <AsyncBoundary
        query={booking}
        skeleton={<Skeleton className="h-28 w-full" />}
        forbidden={
          <ErrorState title="Not available" message="You don’t have access to this booking." />
        }
      >
        {(data) => {
          const b = data.booking
          const meta = BOOKING_STATUS[b.status]
          const started = new Date(b.session.startsAt).getTime() <= now
          const busy = settle.isPending || cancel.isPending

          return (
            <>
              <div className="flex flex-col gap-3">
                <Link
                  href="/bookings"
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
                  Bookings
                </Link>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={b.member.name} className="size-11 text-sm" />
                    <div>
                      <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                        {b.member.name}
                      </h1>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge meta={meta} />
                        <span className="text-sm text-muted">Sign-up #{b.seq}</span>
                      </div>
                    </div>
                  </div>
                  {staff ? (
                    <BookingActions
                      status={b.status}
                      started={started}
                      busy={busy}
                      onSettle={(s) => settle.mutate(s)}
                      onCancel={() => onCancel(b.member.name)}
                      onAddNote={() => setNoteOpen(true)}
                    />
                  ) : null}
                </div>
              </div>

              {b.status === 'WAITLISTED' ? (
                <Callout tone="warning" title="On the waitlist">
                  This member is waiting for a spot. They’ll be promoted to Booked automatically
                  when a Booked member on this session cancels.
                </Callout>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader title="Booking" />
                  <CardBody className="py-2">
                    <dl className="divide-y divide-line">
                      <DataRow label="Member">{b.member.name}</DataRow>
                      <DataRow label="Class">{b.session.class.title}</DataRow>
                      <DataRow label="Session">
                        <Link
                          href={`/sessions/${b.session.id}`}
                          className="text-brand hover:underline"
                        >
                          {formatDateTime(b.session.startsAt)}
                        </Link>
                      </DataRow>
                      <DataRow label="Status">
                        <StatusBadge meta={meta} />
                      </DataRow>
                      <DataRow label="Booked at">{formatDate(b.createdAt)}</DataRow>
                    </dl>
                  </CardBody>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader
                    title="Timeline"
                    description="Every change to this booking, in order. This history is permanent and cannot be edited."
                  />
                  <CardBody>
                    <Timeline events={b.events} />
                  </CardBody>
                </Card>
              </div>

              {staff ? (
                <AddNoteDialog bookingId={id} open={noteOpen} onClose={() => setNoteOpen(false)} />
              ) : null}
            </>
          )
        }}
      </AsyncBoundary>
    </div>
  )
}

function BookingActions({
  status,
  started,
  busy,
  onSettle,
  onCancel,
  onAddNote,
}: {
  status: BookingDetail['status']
  started: boolean
  busy: boolean
  onSettle: (s: 'ATTENDED' | 'NO_SHOW') => void
  onCancel: () => void
  onAddNote: () => void
}) {
  const canSettle = started && status === 'BOOKED'
  const canCancel = status === 'BOOKED' || status === 'WAITLISTED'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSettle ? (
        <>
          <Button variant="secondary" onClick={() => onSettle('ATTENDED')} loading={busy}>
            Mark attended
          </Button>
          <Button variant="ghost" onClick={() => onSettle('NO_SHOW')} disabled={busy}>
            No-show
          </Button>
        </>
      ) : null}
      {canCancel ? (
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel booking
        </Button>
      ) : null}
      <Button variant="secondary" onClick={onAddNote} disabled={busy}>
        Add note
      </Button>
    </div>
  )
}

const eventDotTone: Record<Tone, string> = {
  success: 'var(--tone-success)',
  warning: 'var(--tone-warning)',
  danger: 'var(--tone-danger)',
  info: 'var(--tone-info)',
  neutral: 'var(--tone-neutral)',
}

function describeEvent(event: BookingEvent): { title: string; tone: Tone } {
  if (event.type === 'CREATED') {
    const to = event.toStatus ? BOOKING_STATUS[event.toStatus] : null
    return {
      title: to ? `Booking created — ${to.label}` : 'Booking created',
      tone: to?.tone ?? 'neutral',
    }
  }
  if (event.type === 'NOTE_ADDED') {
    return { title: 'Note added', tone: 'neutral' }
  }
  const from = event.fromStatus ? BOOKING_STATUS[event.fromStatus].label : '—'
  const to = event.toStatus ? BOOKING_STATUS[event.toStatus] : null
  return { title: `${from} → ${to?.label ?? '—'}`, tone: to?.tone ?? 'neutral' }
}

function Timeline({ events }: { events: BookingEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No events recorded.</p>
  }
  return (
    <ol className="relative flex flex-col gap-5 pl-6">
      <span className="absolute top-1.5 bottom-1.5 left-[7px] w-px bg-line" aria-hidden="true" />
      {events.map((event) => {
        const { title, tone } = describeEvent(event)
        return (
          <li key={event.id} className="relative">
            <span
              className="absolute top-1 left-[-1.5rem] size-3.5 rounded-full border-2 border-[var(--surface)]"
              style={{ backgroundColor: eventDotTone[tone] }}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium text-fg">{title}</p>
              <time className="text-xs text-subtle" dateTime={event.createdAt}>
                {formatDateTime(event.createdAt)}
              </time>
            </div>
            <p className="text-xs text-muted">by {event.actor.name}</p>
            {event.note ? (
              <p className="mt-1.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-fg">
                {event.note}
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function AddNoteDialog({
  bookingId,
  open,
  onClose,
}: {
  bookingId: string
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')

  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setNote('')
  }
  if (!open && wasOpen) setWasOpen(false)

  const mutation = useApiMutation(
    () =>
      apiSend<BookingResponse>(`/api/bookings/${bookingId}/notes`, 'POST', { note: note.trim() }),
    {
      invalidate: [qk.booking(bookingId)],
      onSuccess: () => {
        toast.success('Note added')
        onClose()
      },
    },
  )
  useResetOnOpen(open, mutation.reset)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a note"
      description="Notes are appended to the booking’s permanent timeline."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="note-form"
            loading={mutation.isPending}
            disabled={!note.trim()}
          >
            Add note
          </Button>
        </>
      }
    >
      <form
        id="note-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim()) mutation.mutate()
        }}
      >
        {mutation.error ? (
          <Callout tone="danger" role="alert" className="mb-3">
            {mutation.error.message}
          </Callout>
        ) : null}
        <TextArea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Called ahead to say they’ll be 10 minutes late."
          maxLength={1000}
          rows={4}
          required
          autoFocus
        />
      </form>
    </Dialog>
  )
}
