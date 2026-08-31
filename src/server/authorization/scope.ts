// src/server/authorization/scope.ts
import type { Prisma } from '@/generated/prisma/client'
import type { SessionUser } from '@/server/auth/session'

/**
 * Resource-level authorization expressed as a Prisma WHERE fragment, so the
 * authorization predicate travels INTO the database query and is shared,
 * verbatim, by single reads, collections and counts. A count computed under
 * this same fragment cannot report rows the viewer may not see — the
 * "count leaks unauthorized records" failure is impossible by construction.
 *
 * Staff see every session (empty fragment). An instructor sees exactly the
 * sessions where they are the primary instructor OR a co-instructor (Goal 5's
 * visibility rule). The OR compiles to one query with an EXISTS subquery over
 * session_instructors — no N+1, and it rides the Phase-2 indexes
 * (class_sessions.primary_instructor_id and session_instructors.instructor_id).
 */
export function sessionScopeWhere(user: SessionUser): Prisma.ClassSessionWhereInput {
  if (user.role === 'STAFF') return {}
  return {
    OR: [{ primaryInstructorId: user.id }, { coInstructors: { some: { instructorId: user.id } } }],
  }
}

/**
 * Booking-level scope, DERIVED from the session scope rather than restated:
 * a viewer may see a booking iff they may see its session. Deriving it (rather
 * than hand-writing a parallel predicate) is what makes "a future booking
 * search count cannot leak unauthorized rows" structural instead of a
 * convention — the one place the session rule can change is sessionScopeWhere,
 * and Goal 6's booking list and its total (a later phase) will both flow
 * through here.
 */
export function bookingScopeWhere(user: SessionUser): Prisma.BookingWhereInput {
  if (user.role === 'STAFF') return {}
  return { session: sessionScopeWhere(user) }
}
