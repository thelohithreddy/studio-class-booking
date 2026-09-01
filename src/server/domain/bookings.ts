// src/server/domain/bookings.ts
import type { Prisma } from '@/generated/prisma/client'
import type { BookingStatus } from '@/generated/prisma/enums'
import type { Db } from '@/lib/db'
import type { SessionUser } from '@/server/auth/session'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import { parseIdOr404 } from '@/server/domain/ids'
import { assertTransition, consumesCapacity } from '@/server/domain/booking-state'
import { isMembershipValid } from '@/server/domain/membership'
import { bookingScopeWhere } from '@/server/authorization/scope'
import { escapeLike } from '@/server/domain/search'
import type { BookingListQuery } from '@/lib/schemas/domain'

/**
 * The booking engine. Every mutation runs inside one interactive transaction
 * whose FIRST statement locks the session row (SELECT … FOR UPDATE), so all
 * booking operations for a given session are serialized. Crucially, any
 * decision keyed on a booking's own status is made from a RE-READ taken AFTER
 * the lock — the pre-lock load exists only to find the session id. Under the
 * lock the capacity decision, the counter update, the status change and the
 * timeline event are one atomic unit — correct under READ COMMITTED (the lock,
 * not the snapshot, serializes; see docs/decisions.md #21). The Phase-2
 * constraints (booked_count ≤ capacity; one active booking per member+session)
 * are the race-safe backstop, and every status/capacity mutation is wrapped in
 * withDbErrors so an escaped race loses as a clean 409/422, never a raw error
 * (a standalone note, which takes no lock and changes nothing raced-upon, is
 * wrapped the same way for consistency).
 *
 * Capacity invariant: booked_count = count(status ∈ {BOOKED, ATTENDED, NO_SHOW}).
 * WAITLISTED and CANCELLED do not consume a seat; settling a BOOKED booking
 * leaves the count unchanged (decisions.md #22).
 */

const BOOKING_SELECT = {
  id: true,
  seq: true,
  sessionId: true,
  memberId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

// Booking mutations serialize on one session-row lock while holding their
// connection, so a burst queues. Generous ceilings (vs Prisma's 2s/5s
// defaults) let a legitimate queue drain instead of surfacing as a P2028
// timeout; the tx body itself is a handful of short statements. Pool sizing
// for production bursts is a deploy-phase concern (docs/architecture.md).
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

/** Locks the session row for the rest of the transaction. 404 if absent. */
async function lockSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<{ capacity: number; bookedCount: number; startsAt: Date }> {
  const rows = await tx.$queryRaw<
    { capacity: number; booked_count: number; starts_at: Date }[]
  >`SELECT capacity, booked_count, starts_at FROM class_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`
  const row = rows[0]
  if (!row) throw new ApiError(404, 'not_found', 'Session not found.')
  return { capacity: row.capacity, bookedCount: row.booked_count, startsAt: row.starts_at }
}

async function adjustBookedCount(tx: Prisma.TransactionClient, sessionId: string, delta: number) {
  // booked_count ≥ 0 AND ≤ capacity is CHECK-enforced — any drift loses loudly.
  await tx.classSession.update({
    where: { id: sessionId },
    data: { bookedCount: { increment: delta } },
  })
}

/** Re-reads a booking's status under the held lock (never the pre-lock value). */
async function currentStatus(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<BookingStatus> {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true },
  })
  return b.status
}

async function writeStatusEvent(
  tx: Prisma.TransactionClient,
  bookingId: string,
  from: BookingStatus,
  to: BookingStatus,
  actorUserId: string,
  note?: string,
) {
  await tx.bookingEvent.create({
    data: { bookingId, type: 'STATUS_CHANGED', fromStatus: from, toStatus: to, note, actorUserId },
  })
}

// --- create ------------------------------------------------------------------

export async function createBooking(
  db: Db,
  actor: SessionUser,
  input: { sessionId: string; memberId: string; note?: string },
) {
  return withDbErrors(
    () =>
      db.$transaction(async (tx) => {
        const session = await lockSession(tx, input.sessionId)

        const member = await tx.member.findUnique({
          where: { id: input.memberId },
          select: { membershipExpiresOn: true },
        })
        if (!member) throw new ApiError(404, 'not_found', 'Member not found.')
        if (!isMembershipValid(member.membershipExpiresOn)) {
          throw new ApiError(422, 'membership_expired', 'This member’s membership has expired.')
        }

        // Friendly pre-check; the partial-unique index is the race backstop.
        const active = await tx.booking.findFirst({
          where: {
            sessionId: input.sessionId,
            memberId: input.memberId,
            status: { in: ['BOOKED', 'WAITLISTED'] },
          },
          select: { id: true },
        })
        if (active) {
          throw new ApiError(
            409,
            'duplicate_active',
            'This member already has an active booking for this session.',
          )
        }

        const status: BookingStatus =
          session.bookedCount < session.capacity ? 'BOOKED' : 'WAITLISTED'

        const booking = await tx.booking.create({
          data: { sessionId: input.sessionId, memberId: input.memberId, status },
          select: BOOKING_SELECT,
        })
        if (consumesCapacity(status)) await adjustBookedCount(tx, input.sessionId, +1)
        await tx.bookingEvent.create({
          data: {
            bookingId: booking.id,
            type: 'CREATED',
            toStatus: status,
            note: input.note,
            actorUserId: actor.id,
          },
        })
        return booking
      }, TX_OPTIONS),
    { conflict: 'This member already has an active booking for this session.' },
  )
}

// --- cancel (+ promote) ------------------------------------------------------

export async function cancelBooking(db: Db, actor: SessionUser, id: string, note?: string) {
  const bookingId = parseIdOr404(id, 'Booking not found.')
  return withDbErrors(() =>
    db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { sessionId: true },
      })
      if (!booking) throw new ApiError(404, 'not_found', 'Booking not found.')

      await lockSession(tx, booking.sessionId)
      const from = await currentStatus(tx, bookingId) // re-read UNDER the lock
      assertTransition(from, 'CANCELLED')

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED' },
        select: BOOKING_SELECT,
      })
      await writeStatusEvent(tx, bookingId, from, 'CANCELLED', actor.id, note)

      // The counter delta comes from the transition itself (single source of
      // truth): CANCELLED does not consume, so cancelling a consuming status
      // frees a seat. Only a freed BOOKED seat triggers a promotion (Goal 4).
      if (consumesCapacity(from)) {
        await adjustBookedCount(tx, booking.sessionId, -1)
        await promoteEarliestWaitlisted(tx, booking.sessionId, actor.id)
      }
      return updated
    }, TX_OPTIONS),
  )
}

/**
 * Promotes the earliest waitlisted booking on a session, if any, into the seat
 * just freed. "Earliest" is min(seq) — a deterministic, monotonic insertion
 * order (created_at can collide under concurrency). Runs under the session
 * lock, so no other cancellation can promote the same or an extra member.
 *
 * Promotion does NOT re-check the member's membership expiry: it fulfils a
 * waitlist spot the member secured while valid, and the brief gates only the
 * creation of a NEW booking, which promotion is not (decisions.md #23).
 */
async function promoteEarliestWaitlisted(
  tx: Prisma.TransactionClient,
  sessionId: string,
  actorUserId: string,
) {
  const next = await tx.booking.findFirst({
    where: { sessionId, status: 'WAITLISTED' },
    orderBy: { seq: 'asc' },
    select: { id: true },
  })
  if (!next) return
  assertTransition('WAITLISTED', 'BOOKED')
  await tx.booking.update({ where: { id: next.id }, data: { status: 'BOOKED' } })
  await adjustBookedCount(tx, sessionId, +1)
  await writeStatusEvent(tx, next.id, 'WAITLISTED', 'BOOKED', actorUserId)
}

// --- settle ------------------------------------------------------------------

export async function settleBooking(
  db: Db,
  actor: SessionUser,
  id: string,
  status: 'ATTENDED' | 'NO_SHOW',
  note?: string,
) {
  const bookingId = parseIdOr404(id, 'Booking not found.')
  return withDbErrors(() =>
    db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { sessionId: true },
      })
      if (!booking) throw new ApiError(404, 'not_found', 'Booking not found.')

      const session = await lockSession(tx, booking.sessionId)
      // Settlement only after the session's scheduled (start) time has passed.
      if (Date.now() < session.startsAt.getTime()) {
        throw new ApiError(
          422,
          'too_early',
          'A session can only be settled once its start time has passed.',
        )
      }
      const from = await currentStatus(tx, bookingId) // re-read UNDER the lock
      assertTransition(from, status)

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status },
        select: BOOKING_SELECT,
      })
      await writeStatusEvent(tx, bookingId, from, status, actor.id, note)
      // No counter change: ATTENDED/NO_SHOW consume a seat exactly as BOOKED did.
      return updated
    }, TX_OPTIONS),
  )
}

// --- standalone note (Goal 9: "any notes staff leave about it") --------------

export async function addBookingNote(db: Db, actor: SessionUser, id: string, note: string) {
  const bookingId = parseIdOr404(id, 'Booking not found.')
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true } })
  if (!booking) throw new ApiError(404, 'not_found', 'Booking not found.')
  // A NOTE_ADDED event carries no status change (Phase-2 shape CHECK). The
  // timeline is append-only, so a note can never be edited or removed later.
  // No session lock is needed — it changes nothing raced-upon — but it is
  // wrapped like every other mutation so a stray constraint is a clean 4xx.
  await withDbErrors(() =>
    db.bookingEvent.create({
      data: { bookingId, type: 'NOTE_ADDED', note, actorUserId: actor.id },
    }),
  )
  return db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: BOOKING_SELECT })
}

// --- reads -------------------------------------------------------------------

export async function getBooking(db: Db, user: SessionUser, id: string) {
  const bookingId = parseIdOr404(id, 'Booking not found.')
  const booking = await db.booking.findFirst({
    // Scoped: a booking is visible iff its session is (staff: all; instructor:
    // their sessions). Out of scope → 404, not 403 (no existence leak).
    where: { AND: [{ id: bookingId }, bookingScopeWhere(user)] },
    select: {
      ...BOOKING_SELECT,
      // Name only — an instructor reads their sessions' rosters but not member
      // contact PII (email stays a staff-only surface, mirroring attendance export).
      member: { select: { id: true, name: true } },
      session: { select: { id: true, startsAt: true, class: { select: { title: true } } } },
      events: {
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!booking) throw new ApiError(404, 'not_found', 'Booking not found.')
  return booking
}

/**
 * Goal 6 — "Finding bookings". One scoped list with a text search over member
 * name and email, filters for class/session/status, allowlisted sort, and
 * pagination with a total. The authorization scope is the FIRST AND term, so
 * it is applied before filtering AND before counting (the identical `where`
 * feeds both findMany and count) — a client filter can only intersect the
 * scope, never widen it, and the total can never include an out-of-scope row.
 * The sort maps a fixed key/direction to Prisma orderBy (no user column ever
 * reaches SQL) with a unique `id` tiebreaker so rows never shuffle across
 * pages. All of it runs in the database.
 */
export async function listBookings(db: Db, user: SessionUser, query: BookingListQuery) {
  const { page, pageSize, q, classId, sessionId, status, sort, dir } = query

  const filters: Prisma.BookingWhereInput[] = []
  if (classId) filters.push({ session: { classId } })
  if (sessionId) filters.push({ sessionId })
  if (status) filters.push({ status })
  if (q) {
    // Literal, case-insensitive substring over member name OR email.
    const term = escapeLike(q)
    filters.push({
      member: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
    })
  }

  // Scope FIRST — intersection with every filter, never a union.
  const where: Prisma.BookingWhereInput = { AND: [bookingScopeWhere(user), ...filters] }

  // Fixed key→orderBy map, always ending in the unique `id` tiebreaker so pages
  // are stable. The `?? bookedAt` fallback is belt-and-suspenders: even if a
  // future sort key reached here unmapped, pagination keeps a total order
  // rather than silently losing determinism.
  const orderByByKey: Record<typeof sort, Prisma.BookingOrderByWithRelationInput[]> = {
    bookedAt: [{ createdAt: dir }, { id: dir }],
    status: [{ status: dir }, { id: dir }],
    session: [{ session: { startsAt: dir } }, { id: dir }],
  }
  const orderBy = orderByByKey[sort] ?? orderByByKey.bookedAt

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...BOOKING_SELECT,
        // Name only — never member email (a staff-only surface), password
        // hashes, notes or the event timeline.
        member: { select: { id: true, name: true } },
        session: { select: { id: true, startsAt: true, class: { select: { title: true } } } },
      },
    }),
    db.booking.count({ where }),
  ])
  return { bookings, total, page, pageSize }
}
