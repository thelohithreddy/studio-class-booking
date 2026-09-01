// src/server/domain/sessions.ts
import type { Db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import type { CreateSessionInput, UpdateSessionInput } from '@/lib/schemas/domain'
import { computeEndsAt } from '@/server/domain/interval'
import { parseIdOr404 } from '@/server/domain/ids'
import {
  assertInstructorFree,
  lockInstructorRows,
  lockSessionRow,
} from '@/server/domain/scheduling'

// Match the booking engine's generous ceilings so a queue on a session-row lock
// drains rather than surfacing as a P2028 timeout; each tx is a few short
// statements.
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

/**
 * Session fields plus SAFE display relations (class title/discipline, room
 * name, instructor name) so Goal 5's "my sessions" list is a usable view, not
 * a wall of UUIDs. Deliberately NO member or booking relations — those carry
 * PII and must never ride along in an instructor-visible payload.
 */
const SESSION_SELECT = {
  id: true,
  classId: true,
  startsAt: true,
  endsAt: true,
  durationMinutes: true,
  capacity: true,
  bookedCount: true,
  primaryInstructorId: true,
  roomId: true,
  createdAt: true,
  updatedAt: true,
  class: { select: { title: true, discipline: true } },
  room: { select: { name: true } },
  primaryInstructor: { select: { id: true, name: true } },
} as const

/**
 * Friendly, race-losing pre-check for the ROOM axis: is the room already booked
 * over [startsAt, endsAt)? Half-open, so adjacency is fine. Excludes the session
 * being edited. The GiST room exclusion constraint is the authoritative race
 * backstop; this returns a clean 409 before the write. The DB interval predicate
 * (`starts_at < end AND ends_at > start`) is exactly half-open overlap and rides
 * the Phase-2 index, so no code-side re-confirm is needed.
 *
 * The INSTRUCTOR axis is handled separately by assertInstructorFree (scheduling.ts),
 * because an instructor conflicts in ANY capacity (primary OR co) — a domain the
 * single-table room/primary exclusion constraints cannot express.
 */
async function assertRoomFree(
  tx: Prisma.TransactionClient,
  roomId: string,
  startsAt: Date,
  endsAt: Date,
  excludeSessionId?: string,
): Promise<void> {
  const clash = await tx.classSession.findFirst({
    where: {
      roomId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    throw new ApiError(409, 'room_conflict', 'That room is already booked for this time.')
  }
}

/** Resolves and validates the class, instructor and room referenced by a write. */
export async function resolveRefs(
  db: Db,
  classId: string,
  primaryInstructorId: string,
  roomId: string,
  { requireActiveClass }: { requireActiveClass: boolean },
): Promise<{ defaultDurationMinutes: number; defaultCapacity: number }> {
  const klass = await db.class.findUnique({
    where: { id: classId },
    select: { archivedAt: true, defaultDurationMinutes: true, defaultCapacity: true },
  })
  if (!klass) throw new ApiError(404, 'not_found', 'Class not found.')
  if (requireActiveClass && klass.archivedAt) {
    throw new ApiError(409, 'class_archived', 'Cannot schedule a session on an archived class.')
  }

  // The instructor's INSTRUCTOR role is resolved server-side — never trusted
  // from the request. A staff user (or any non-instructor) is rejected.
  const instructor = await db.user.findUnique({
    where: { id: primaryInstructorId },
    select: { role: true },
  })
  if (!instructor) throw new ApiError(404, 'not_found', 'Primary instructor not found.')
  if (instructor.role !== 'INSTRUCTOR') {
    throw new ApiError(
      422,
      'not_an_instructor',
      'The primary instructor must have the instructor role.',
    )
  }

  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true } })
  if (!room) throw new ApiError(404, 'not_found', 'Room not found.')

  return klass
}

export async function createSession(db: Db, input: CreateSessionInput) {
  const klass = await resolveRefs(db, input.classId, input.primaryInstructorId, input.roomId, {
    requireActiveClass: true,
  })

  const startsAt = new Date(input.startsAt)
  const durationMinutes = input.durationMinutes ?? klass.defaultDurationMinutes
  const capacity = input.capacity ?? klass.defaultCapacity
  const endsAt = computeEndsAt(startsAt, durationMinutes)

  const created = await withDbErrors(
    () =>
      db.$transaction(async (tx) => {
        // The session row does not exist yet, so there is nothing to lock on
        // the room/session axis beyond the exclusion constraints. Lock the
        // primary instructor's user row so a concurrent op that would give them
        // an overlapping session in ANY capacity (primary or co) is serialized
        // — the primary-vs-co axis has no constraint, so the app check under
        // this lock is what makes it race-safe. The room + primary-vs-primary
        // exclusion constraints backstop those two axes.
        await lockInstructorRows(tx, [input.primaryInstructorId])
        await assertInstructorFree(tx, input.primaryInstructorId, startsAt, endsAt)
        await assertRoomFree(tx, input.roomId, startsAt, endsAt)

        return tx.classSession.create({
          data: {
            classId: input.classId,
            startsAt,
            durationMinutes,
            endsAt,
            capacity,
            primaryInstructorId: input.primaryInstructorId,
            roomId: input.roomId,
            // bookedCount is server-managed (defaults to 0) — never from input.
          },
          select: { id: true },
        })
      }, TX_OPTIONS),
    { conflict: 'That time slot is no longer available.' },
  )
  // Read the display projection after commit (a nested-relation select inside
  // the interactive transaction pipelines on its single held connection).
  return db.classSession.findUniqueOrThrow({ where: { id: created.id }, select: SESSION_SELECT })
}

export async function updateSession(db: Db, id: string, input: UpdateSessionInput) {
  const validId = parseIdOr404(id, 'Session not found.')

  // Validate any CHANGED reference up front (reads only; no locks). A missing
  // ref fails here as 404/422 before the transaction. The class is immutable in
  // Phase 5, so no archived-class re-check on edit. These are re-resolved
  // against the locked row inside the transaction.
  if (input.primaryInstructorId) {
    const instructor = await db.user.findUnique({
      where: { id: input.primaryInstructorId },
      select: { role: true },
    })
    if (!instructor) throw new ApiError(404, 'not_found', 'Primary instructor not found.')
    if (instructor.role !== 'INSTRUCTOR') {
      throw new ApiError(
        422,
        'not_an_instructor',
        'The primary instructor must have the instructor role.',
      )
    }
  }
  if (input.roomId) {
    const room = await db.room.findUnique({ where: { id: input.roomId }, select: { id: true } })
    if (!room) throw new ApiError(404, 'not_found', 'Room not found.')
  }

  await withDbErrors(
    () =>
      db.$transaction(async (tx) => {
        // Lock the session row FIRST and re-read its authoritative state under
        // the lock. This is the outermost lock everywhere (session → users), so
        // it closes both the lost-update race (two concurrent PATCHes) and the
        // co-instructor double-book race (a concurrent co-add serializes here).
        const existing = await lockSessionRow(tx, validId)

        const primaryInstructorId = input.primaryInstructorId ?? existing.primaryInstructorId
        const roomId = input.roomId ?? existing.roomId
        const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt
        const durationMinutes = input.durationMinutes ?? existing.durationMinutes
        const capacity = input.capacity ?? existing.capacity
        const endsAt = computeEndsAt(startsAt, durationMinutes)

        const intervalChanged =
          startsAt.getTime() !== existing.startsAt.getTime() ||
          durationMinutes !== existing.durationMinutes
        const primaryChanged = primaryInstructorId !== existing.primaryInstructorId
        const roomChanged = roomId !== existing.roomId

        // Current co-instructors: needed to (a) reject promoting a co to primary,
        // (b) lock them, and (c) re-check them when the interval moves.
        const coRows = await tx.sessionInstructor.findMany({
          where: { sessionId: validId },
          select: { instructorId: true },
        })
        const coIds = coRows.map((c) => c.instructorId)

        // An instructor cannot be primary AND co of the same session.
        if (primaryChanged && coIds.includes(primaryInstructorId)) {
          throw new ApiError(
            422,
            'already_co',
            'That instructor is already a co-instructor of this session.',
          )
        }

        // Which instructors must be free in the NEW window?
        //  - interval moved   → the primary AND every co,
        //  - primary swapped  → the new primary,
        //  - room/capacity    → none (the session lock still guards lost updates).
        const toCheck = [
          ...new Set(
            intervalChanged
              ? [primaryInstructorId, ...coIds]
              : primaryChanged
                ? [primaryInstructorId]
                : [],
          ),
        ]

        // Lock exactly the instructors we are about to check (sorted uuid order,
        // enforced by lockInstructorRows) so each overlap check is atomic against
        // any concurrent op touching that instructor on another session.
        await lockInstructorRows(tx, toCheck)
        for (const instructorId of toCheck) {
          await assertInstructorFree(tx, instructorId, startsAt, endsAt, validId)
        }
        if (intervalChanged || roomChanged) {
          await assertRoomFree(tx, roomId, startsAt, endsAt, validId)
        }

        const data: Prisma.ClassSessionUpdateInput = {
          startsAt,
          endsAt,
          durationMinutes,
          capacity,
          primaryInstructor: { connect: { id: primaryInstructorId } },
          room: { connect: { id: roomId } },
        }
        await tx.classSession.update({ where: { id: validId }, data, select: { id: true } })
      }, TX_OPTIONS),
    { check: 'Capacity cannot be below the number of members already booked.' },
  )
  // Read the display projection after commit (see createSession).
  return db.classSession.findUniqueOrThrow({ where: { id: validId }, select: SESSION_SELECT })
}

/**
 * Hard-delete a session — but only one with no bookings. A session that has
 * ever been booked is permanently undeletable (the RESTRICT foreign key fires;
 * Goal 9's immutable history outranks Goal 3's unqualified "deleted"). The FK
 * violation is translated to a clean 409.
 */
export async function deleteSession(db: Db, id: string) {
  const validId = parseIdOr404(id, 'Session not found.')
  const existing = await db.classSession.findUnique({
    where: { id: validId },
    select: { id: true },
  })
  if (!existing) throw new ApiError(404, 'not_found', 'Session not found.')

  await withDbErrors(() => db.classSession.delete({ where: { id: validId } }), {
    conflict: 'This session has bookings and cannot be deleted.',
  })
}
