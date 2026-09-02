// tests/unit/frontend-status.test.ts
//
// The client-side status semantics — how the UI classifies memberships, session
// fill, class state, and booking statuses. Pure logic, no DOM.
import { describe, expect, it } from 'vitest'

import {
  BOOKING_STATUS,
  BOOKING_STATUS_ORDER,
  classState,
  membershipFromDays,
  membershipFromExpiry,
  sessionFill,
} from '@app/_lib/status'

describe('membershipFromDays', () => {
  it('classifies expired / expiring / active by day count', () => {
    expect(membershipFromDays(-1).state).toBe('expired')
    expect(membershipFromDays(-30).state).toBe('expired')
    expect(membershipFromDays(0).state).toBe('expiring') // expires today is still within window
    expect(membershipFromDays(7).state).toBe('expiring') // inclusive 7th day
    expect(membershipFromDays(8).state).toBe('active')
    expect(membershipFromDays(365).state).toBe('active')
  })

  it('maps state to a non-color tone + label', () => {
    expect(membershipFromDays(-1).tone).toBe('danger')
    expect(membershipFromDays(3).tone).toBe('warning')
    expect(membershipFromDays(100).tone).toBe('success')
    expect(membershipFromDays(3).label).toMatch(/expiring/i)
  })
})

describe('membershipFromExpiry (calendar-date, UTC — no timezone drift)', () => {
  const today = new Date('2026-09-10T12:00:00.000Z')

  it('reads UTC-midnight ISO and bare YYYY-MM-DD identically', () => {
    expect(membershipFromExpiry('2026-09-15T00:00:00.000Z', today).state).toBe('expiring')
    expect(membershipFromExpiry('2026-09-15', today).state).toBe('expiring')
  })

  it('treats today and the seventh day as still expiring, the eighth as active', () => {
    expect(membershipFromExpiry('2026-09-10', today).state).toBe('expiring')
    expect(membershipFromExpiry('2026-09-17', today).state).toBe('expiring')
    expect(membershipFromExpiry('2026-09-18', today).state).toBe('active')
  })

  it('flags a past date as expired', () => {
    expect(membershipFromExpiry('2026-09-09', today).state).toBe('expired')
  })
})

describe('sessionFill', () => {
  it('is open below 80% capacity', () => {
    const fill = sessionFill(3, 10)
    expect(fill.tone).toBe('success')
    expect(fill.isFull).toBe(false)
    expect(fill.label).toBe('Open')
  })

  it('warns at or above 80% but not full', () => {
    expect(sessionFill(8, 10).tone).toBe('warning')
    expect(sessionFill(9, 10).label).toBe('Filling up')
  })

  it('is full when booked meets or exceeds capacity', () => {
    const fill = sessionFill(10, 10)
    expect(fill.isFull).toBe(true)
    expect(fill.tone).toBe('danger')
    expect(fill.ratio).toBe(1)
  })

  it('handles a zero-capacity session without NaN (treated as full)', () => {
    const fill = sessionFill(0, 0)
    expect(fill.isFull).toBe(true)
    expect(Number.isFinite(fill.ratio)).toBe(true)
  })
})

describe('classState', () => {
  it('reflects archived vs active', () => {
    expect(classState(null).label).toBe('Active')
    expect(classState('2026-01-01T00:00:00.000Z').label).toBe('Archived')
    expect(classState('2026-01-01T00:00:00.000Z').tone).toBe('neutral')
  })
})

describe('booking status table', () => {
  it('covers all five statuses in the exact stable order it names', () => {
    expect(BOOKING_STATUS_ORDER).toEqual([
      'BOOKED',
      'WAITLISTED',
      'ATTENDED',
      'NO_SHOW',
      'CANCELLED',
    ])
    for (const status of BOOKING_STATUS_ORDER) {
      expect(BOOKING_STATUS[status].label).toBeTruthy()
    }
    expect(BOOKING_STATUS.WAITLISTED.tone).toBe('warning')
    expect(BOOKING_STATUS.NO_SHOW.tone).toBe('danger')
    expect(BOOKING_STATUS.ATTENDED.tone).toBe('success')
  })
})
