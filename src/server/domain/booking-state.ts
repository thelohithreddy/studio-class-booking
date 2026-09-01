// src/server/domain/booking-state.ts
import type { BookingStatus } from '@/generated/prisma/enums'
import { ApiError } from '@/lib/api/errors'

/**
 * The one authoritative booking state machine (Goal 4). No route or service
 * duplicates transition logic — everything asks this module.
 *
 * Legal transitions:
 *   (create) → BOOKED | WAITLISTED   — the create decision (capacity)
 *   BOOKED    → CANCELLED
 *   WAITLISTED→ CANCELLED
 *   BOOKED    → ATTENDED | NO_SHOW    — settlement (after the scheduled time)
 *   WAITLISTED→ BOOKED                — waitlist promotion (an internal move,
 *                                       never a client-issued verb)
 * Every other move — CANCELLED/ATTENDED/NO_SHOW are terminal, WAITLISTED cannot
 * be settled, a booking cannot re-enter an active state except by promotion —
 * is rejected.
 */
const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  BOOKED: ['CANCELLED', 'ATTENDED', 'NO_SHOW'],
  WAITLISTED: ['CANCELLED', 'BOOKED'],
  CANCELLED: [],
  ATTENDED: [],
  NO_SHOW: [],
}

/** The capacity-consuming states: a seat taken (held, or used after the session). */
export const CAPACITY_CONSUMING: readonly BookingStatus[] = ['BOOKED', 'ATTENDED', 'NO_SHOW']

export function consumesCapacity(status: BookingStatus): boolean {
  return CAPACITY_CONSUMING.includes(status)
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to)
}

/**
 * Asserts a transition is legal, throwing a 422 with the reason otherwise.
 * Used by every state-changing booking operation so an illegal move can never
 * be persisted.
 */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError(
      422,
      'invalid_transition',
      `A ${from.toLowerCase()} booking cannot become ${to.toLowerCase()}.`,
    )
  }
}
