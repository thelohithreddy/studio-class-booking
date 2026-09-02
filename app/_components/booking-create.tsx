// app/_components/booking-create.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useInvalidate } from '@app/_lib/query'
import { useResetOnOpen } from '@app/_lib/use-reset-on-open'
import type { BookingResponse, BookingStatus } from '@app/_lib/types'
import { Button, Callout, Drawer, TextArea } from '@app/_components/ui'
import { MemberPicker, SessionPicker } from '@app/_components/pickers'

interface FixedSession {
  id: string
  label: string
  capacity?: number
  bookedCount?: number
}

interface Result {
  status: BookingStatus
  id: string
  memberName: string
  sessionLabel: string
  capacity?: number
  /** Confirmed seats used BEFORE this booking (for the "seat X of Y" line). */
  bookedBefore?: number
}

/**
 * Create a booking. The server decides Booked vs Waitlisted under a capacity
 * lock, so we never guess — we submit, then show exactly what happened. A full
 * session is not an error here; it produces a Waitlisted result with clear copy.
 * `fixedSession` preselects (and locks) the session when booking from a session.
 */
export function BookingCreateDrawer({
  open,
  onClose,
  fixedSession,
}: {
  open: boolean
  onClose: () => void
  fixedSession?: FixedSession | null
}) {
  const invalidate = useInvalidate()
  const [memberId, setMemberId] = useState<string | null>(null)
  const [memberName, setMemberName] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionLabel, setSessionLabel] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setMemberId(null)
    setMemberName('')
    setNote('')
    setResult(null)
    setSessionId(fixedSession?.id ?? null)
    setSessionLabel(fixedSession?.label ?? '')
  }
  if (!open && wasOpen) setWasOpen(false)

  const mutation = useApiMutation(
    () =>
      apiSend<BookingResponse>('/api/bookings', 'POST', {
        sessionId,
        memberId,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    {
      onSuccess: (data) => {
        setResult({
          status: data.booking.status,
          id: data.booking.id,
          memberName,
          sessionLabel,
          capacity: fixedSession?.capacity,
          bookedBefore: fixedSession?.bookedCount,
        })
        // qk.sessions() too: a Booked result changes the session's bookedCount,
        // which the sessions list / class detail / picker badges all display.
        invalidate([
          qk.bookings(),
          qk.dashboard,
          qk.sessions(),
          ...(sessionId ? [qk.session(sessionId)] : []),
        ])
      },
    },
  )

  useResetOnOpen(open, mutation.reset)

  const canSubmit = Boolean(memberId && sessionId)

  function bookAnother() {
    setResult(null)
    setMemberId(null)
    setMemberName('')
    setNote('')
    if (!fixedSession) {
      setSessionId(null)
      setSessionLabel('')
    }
    mutation.reset()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New booking"
      description={
        result
          ? undefined
          : 'Reserve a spot for a member. If the session is full, they’ll be waitlisted.'
      }
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={bookAnother}>
              Book another
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="booking-form"
              loading={mutation.isPending}
              disabled={!canSubmit}
            >
              Create booking
            </Button>
          </>
        )
      }
    >
      {result ? (
        <BookingResult result={result} onView={onClose} />
      ) : (
        <form
          id="booking-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          className="flex flex-col gap-4"
        >
          {mutation.error ? (
            <Callout tone="danger" role="alert" title="Couldn’t create this booking">
              {mutation.error.message}
            </Callout>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-fg">Member</span>
            <MemberPicker
              value={memberId}
              onChange={(v, item) => {
                setMemberId(v)
                setMemberName(item.label)
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-fg">Session</span>
            {fixedSession ? (
              <div className="rounded-lg border border-line bg-surface-2/60 px-3.5 py-3">
                <p className="text-sm font-medium text-fg">{fixedSession.label}</p>
                {typeof fixedSession.capacity === 'number' &&
                typeof fixedSession.bookedCount === 'number' ? (
                  <p className="mt-0.5 text-[0.8125rem] text-muted">
                    {fixedSession.bookedCount >= fixedSession.capacity ? (
                      <span className="text-[color:var(--tone-warning)]">
                        Full — the next booking will be waitlisted.
                      </span>
                    ) : (
                      <>
                        <span className="tabular">
                          {fixedSession.bookedCount}/{fixedSession.capacity}
                        </span>{' '}
                        booked ·{' '}
                        <span className="font-medium text-fg">
                          {fixedSession.capacity - fixedSession.bookedCount} seat
                          {fixedSession.capacity - fixedSession.bookedCount === 1 ? '' : 's'} left
                        </span>
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            ) : (
              <SessionPicker
                value={sessionId}
                onChange={(v, item) => {
                  setSessionId(v)
                  setSessionLabel(item.label)
                }}
              />
            )}
          </div>

          <TextArea
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for this booking — recorded on its timeline."
            maxLength={1000}
            rows={2}
          />
        </form>
      )}
    </Drawer>
  )
}

function BookingResult({ result, onView }: { result: Result; onView: () => void }) {
  const waitlisted = result.status === 'WAITLISTED'
  const tone = waitlisted ? 'warning' : 'success'
  const seatLine =
    !waitlisted && typeof result.capacity === 'number' && typeof result.bookedBefore === 'number'
      ? `Seat ${result.bookedBefore + 1} of ${result.capacity}`
      : null

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
      <span
        className="anim-pop-in flex size-14 items-center justify-center rounded-full"
        style={{ backgroundColor: `var(--tone-${tone}-bg)`, color: `var(--tone-${tone})` }}
      >
        {waitlisted ? (
          <svg
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      <div>
        <p className="eyebrow" style={{ color: `var(--tone-${tone})` }}>
          {waitlisted ? 'Added to waitlist' : 'Booking confirmed'}
        </p>
        <p className="mt-1 text-lg font-semibold text-fg">{result.memberName}</p>
      </div>

      <div className="w-full rounded-lg border border-line bg-surface-2/50 px-4 py-3">
        <p className="text-sm font-medium text-fg">{result.sessionLabel}</p>
        {seatLine ? <p className="tabular mt-0.5 text-[0.8125rem] text-muted">{seatLine}</p> : null}
      </div>

      <p className="max-w-xs text-[0.8125rem] text-muted">
        {waitlisted
          ? 'This isn’t a confirmed seat yet. They’ll be promoted automatically the moment one frees up.'
          : 'The seat is reserved — this member is all set.'}
      </p>

      <Link
        href={`/bookings/${result.id}`}
        onClick={onView}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        View booking
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  )
}
