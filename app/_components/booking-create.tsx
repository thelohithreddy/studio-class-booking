// app/_components/booking-create.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useInvalidate } from '@app/_lib/query'
import { BOOKING_STATUS } from '@app/_lib/status'
import type { BookingResponse, BookingStatus } from '@app/_lib/types'
import { Button, Callout, Drawer, TextArea } from '@app/_components/ui'
import { MemberPicker, SessionPicker } from '@app/_components/pickers'

interface Result {
  status: BookingStatus
  id: string
  memberName: string
  sessionLabel: string
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
  fixedSession?: { id: string; label: string } | null
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
        setResult({ status: data.booking.status, id: data.booking.id, memberName, sessionLabel })
        invalidate([qk.bookings(), qk.dashboard, ...(sessionId ? [qk.session(sessionId)] : [])])
      },
    },
  )

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
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
                {fixedSession.label}
              </p>
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
  const meta = BOOKING_STATUS[result.status]
  const waitlisted = result.status === 'WAITLISTED'
  return (
    <div className="flex flex-col gap-4">
      <Callout tone={meta.tone} title={waitlisted ? 'Added to the waitlist' : 'Spot confirmed'}>
        {waitlisted ? (
          <>
            <strong>{result.memberName}</strong> is on the waitlist for {result.sessionLabel}. This
            is not a confirmed spot — they’ll be promoted to Booked automatically as soon as one
            frees up.
          </>
        ) : (
          <>
            <strong>{result.memberName}</strong> is booked into {result.sessionLabel} with a
            confirmed spot.
          </>
        )}
      </Callout>

      <Link
        href={`/bookings/${result.id}`}
        onClick={onView}
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline"
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
