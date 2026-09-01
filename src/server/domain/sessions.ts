// src/server/domain/sessions.ts
import type { Db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import type { CreateSessionInput, UpdateSessionInput } from '@/lib/schemas/domain'
import { computeEndsAt, intervalsOverlap } from '@/server/domain/interval'
import { parseIdOr404 } from '@/server/domain/ids'

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

type Resolved = {
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  capacity: number
  primaryInstructorId: string
  roomId: string
}

/**
 * Friendly, race-losing pre-check: is the room or the primary instructor
 * already occupied over [startsAt, endsAt)? Excludes `excludeSessionId` (the
 * session being edited). Half-open interval — adjacency is fine. The database
 * exclusion constraints remain the authoritative backstop; this exists to
 * return a clean 409 before the write instead of relying on the constraint
 * error alone.
 *
 * One query: fetch the room's and instructor's candidate-overlapping sessions
 * in a single findMany (the DB filters by an interval predicate that rides the
 * Phase-2 GiST/btree indexes), then confirm overlap in code.
 */
async function assertNoConflict(db: Db, r: Resolved, excludeSessionId?: string): Promise<void> {
  const candidates = await db.classSession.findMany({
    where: {
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      OR: [{ roomId: r.roomId }, { primaryInstructorId: r.primaryInstructorId }],
      // Interval overlap at the DB layer: existing.starts < candidate.end AND
      // existing.ends > candidate.start.
      startsAt: { lt: r.endsAt },
      endsAt: { gt: r.startsAt },
    },
    select: { roomId: true, primaryInstructorId: true, startsAt: true, endsAt: true },
  })

  for (const c of candidates) {
    if (!intervalsOverlap(r.startsAt, r.endsAt, c.startsAt, c.endsAt)) continue
    if (c.roomId === r.roomId) {
      throw new ApiError(409, 'room_conflict', 'That room is already booked for this time.')
    }
    if (c.primaryInstructorId === r.primaryInstructorId) {
      throw new ApiError(
        409,
        'instructor_conflict',
        'That instructor already has a session at this time.',
      )
    }
  }
}

/** Resolves and validates the class, instructor and room referenced by a write. */
async function resolveRefs(
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

  const resolved: Resolved = {
    startsAt,
    endsAt,
    durationMinutes,
    capacity,
    primaryInstructorId: input.primaryInstructorId,
    roomId: input.roomId,
  }

  await assertNoConflict(db, resolved)

  return withDbErrors(() =>
    db.classSession.create({
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
      select: SESSION_SELECT,
    }),
  )
}

export async function updateSession(db: Db, id: string, input: UpdateSessionInput) {
  const validId = parseIdOr404(id, 'Session not found.')
  const existing = await db.classSession.findUnique({
    where: { id: validId },
    select: {
      classId: true,
      startsAt: true,
      endsAt: true,
      durationMinutes: true,
      capacity: true,
      primaryInstructorId: true,
      roomId: true,
    },
  })
  if (!existing) throw new ApiError(404, 'not_found', 'Session not found.')

  const primaryInstructorId = input.primaryInstructorId ?? existing.primaryInstructorId
  const roomId = input.roomId ?? existing.roomId

  // Re-validate any changed reference. The class is not changing (classId is
  // immutable in Phase 5), so no archived-class re-check on edit.
  if (input.primaryInstructorId && input.primaryInstructorId !== existing.primaryInstructorId) {
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
  if (input.roomId && input.roomId !== existing.roomId) {
    const room = await db.room.findUnique({ where: { id: input.roomId }, select: { id: true } })
    if (!room) throw new ApiError(404, 'not_found', 'Room not found.')
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt
  const durationMinutes = input.durationMinutes ?? existing.durationMinutes
  const capacity = input.capacity ?? existing.capacity
  const endsAt = computeEndsAt(startsAt, durationMinutes)

  const resolved: Resolved = {
    startsAt,
    endsAt,
    durationMinutes,
    capacity,
    primaryInstructorId,
    roomId,
  }

  // Re-run conflict validation against the NEW values (a create-time check does
  // not stay valid forever). Exclude self.
  await assertNoConflict(db, resolved, validId)

  const data: Prisma.ClassSessionUpdateInput = {
    startsAt,
    endsAt,
    durationMinutes,
    capacity,
    primaryInstructor: { connect: { id: primaryInstructorId } },
    room: { connect: { id: roomId } },
  }

  return withDbErrors(
    () => db.classSession.update({ where: { id: validId }, data, select: SESSION_SELECT }),
    { check: 'Capacity cannot be below the number of members already booked.' },
  )
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
