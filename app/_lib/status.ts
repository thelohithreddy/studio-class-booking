// app/_lib/status.ts
//
// The single source of truth for how domain states are named and toned across
// the whole product. Tone maps to the .tone-* classes in globals.css; every
// consumer pairs the tone with the label (and often a dot), so meaning never
// rests on color alone.

import type { BookingStatus } from './types'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusMeta {
  label: string
  tone: Tone
  /** One-line explanation, used in tooltips / result panels. */
  description: string
}

export const BOOKING_STATUS: Record<BookingStatus, StatusMeta> = {
  BOOKED: {
    label: 'Booked',
    tone: 'info',
    description: 'Holds a confirmed spot in the session.',
  },
  WAITLISTED: {
    label: 'Waitlisted',
    tone: 'warning',
    description: 'Not a confirmed spot — promoted automatically when one frees up.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    description: 'No longer holds a spot.',
  },
  ATTENDED: {
    label: 'Attended',
    tone: 'success',
    description: 'Marked present for the session.',
  },
  NO_SHOW: {
    label: 'No show',
    tone: 'danger',
    description: 'Booked but did not attend.',
  },
}

/** The order bookings are grouped/sorted in status filters and legends. */
export const BOOKING_STATUS_ORDER: BookingStatus[] = [
  'BOOKED',
  'WAITLISTED',
  'ATTENDED',
  'NO_SHOW',
  'CANCELLED',
]

// ── Membership state (derived from days-remaining) ──────────────────────────
export type MembershipState = 'active' | 'expiring' | 'expired'

export interface MembershipMeta extends StatusMeta {
  state: MembershipState
}

/** Classify a membership from whole days until expiry (studio-local). */
export function membershipFromDays(daysRemaining: number): MembershipMeta {
  if (daysRemaining < 0) {
    return {
      state: 'expired',
      label: 'Expired',
      tone: 'danger',
      description: 'Membership has lapsed — this member cannot make new bookings.',
    }
  }
  if (daysRemaining <= 7) {
    return {
      state: 'expiring',
      label: 'Expiring soon',
      tone: 'warning',
      description: 'Membership expires within the next seven days.',
    }
  }
  return {
    state: 'active',
    label: 'Active',
    tone: 'success',
    description: 'Membership is current.',
  }
}

/**
 * Classify a membership from its expiry date string (UTC-midnight ISO or bare
 * YYYY-MM-DD), comparing whole calendar days in UTC — the same date-only
 * semantics the server uses. `today` is injectable for tests.
 */
export function membershipFromExpiry(expiresOn: string, today: Date = new Date()): MembershipMeta {
  const iso = expiresOn.length === 10 ? `${expiresOn}T00:00:00.000Z` : expiresOn
  const expiryUtc = Date.UTC(
    new Date(iso).getUTCFullYear(),
    new Date(iso).getUTCMonth(),
    new Date(iso).getUTCDate(),
  )
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const days = Math.round((expiryUtc - todayUtc) / 86_400_000)
  return membershipFromDays(days)
}

// ── Session fill state (capacity pressure) ──────────────────────────────────
export interface FillMeta {
  /** Fraction 0..1 of confirmed seats used (clamped). */
  ratio: number
  tone: Tone
  label: string
  /** Waitlist count when over capacity (bookedCount only counts confirmed seats). */
  isFull: boolean
}

/**
 * Booking pressure for a session. `bookedCount` from the API counts only
 * confirmed seats (BOOKED/ATTENDED/NO_SHOW), so full ⇔ bookedCount ≥ capacity.
 */
export function sessionFill(bookedCount: number, capacity: number): FillMeta {
  const ratio = capacity > 0 ? Math.min(bookedCount / capacity, 1) : bookedCount > 0 ? 1 : 0
  const isFull = bookedCount >= capacity
  if (isFull) return { ratio: 1, tone: 'danger', label: 'Full', isFull: true }
  if (ratio >= 0.8) return { ratio, tone: 'warning', label: 'Filling up', isFull: false }
  return { ratio, tone: 'success', label: 'Open', isFull: false }
}

// ── Class state ─────────────────────────────────────────────────────────────
export function classState(archivedAt: string | null): StatusMeta {
  return archivedAt
    ? {
        label: 'Archived',
        tone: 'neutral',
        description: 'Hidden from default views; sessions preserved.',
      }
    : { label: 'Active', tone: 'success', description: 'Visible and schedulable.' }
}
