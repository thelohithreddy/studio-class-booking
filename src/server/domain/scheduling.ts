// src/server/domain/scheduling.ts
import type { Prisma } from '@/generated/prisma/client'
import { ApiError } from '@/lib/api/errors'

/**
 * The concurrency spine for every schedule mutation (create, co-add, time-edit,
 * primary-change, recurring). Two ideas:
 *
 *  1. instructorHasOverlap — the SINGLE conflict predicate. An instructor may
 *     not be in two time-overlapping sessions in ANY capacity (primary OR co).
 *     The room and primary-vs-primary axes have GiST exclusion constraints
 *     (Phase 2), but co-instructor overlap spans class_sessions ⋈
 *     session_instructors and CANNOT be a single-table exclusion — so it is the
 *     application's job, made race-safe by the locks below.
 *
 *  2. Lock order — SESSION ROW FIRST, THEN instructor user rows (sorted uuid).
 *     A co-add and a concurrent time-edit of the SAME session would otherwise
 *     take disjoint locks and both commit, double-booking a co-instructor (the
 *     child INSERT's FOR KEY SHARE on the parent row does not conflict with the
 *     time-edit's FOR NO KEY UPDATE of non-key columns). Making both take the
 *     session's row lock FIRST serializes them; locking the affected instructor
 *     rows too serializes an instructor against operations on OTHER sessions
 *     (e.g. creating a session with that instructor as primary). The order is
 *     uniform — session → users — so scheduling ops never deadlock each other,
 *     and it is deadlock-free against the booking engine, which locks only the
 *     session row and never a user row (see docs/decisions.md #28).
 */

/**
 * Does `instructorId` already teach — as primary OR co-instructor — a session
 * overlapping [startsAt, endsAt)? Half-open, so adjacency (back-to-back) is not
 * a conflict. `excludeSessionId` omits the session being edited from the check.
 * One index-backed query (a scalar predicate OR an EXISTS sub-select), run
 * inside the caller's transaction UNDER the instructor's row lock.
 */
export async function instructorHasOverlap(
  tx: Prisma.TransactionClient,
  instructorId: string,
  startsAt: Date,
  endsAt: Date,
  excludeSessionId?: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ overlap: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM class_sessions cs
      WHERE cs.starts_at < ${endsAt} AND cs.ends_at > ${startsAt}
        AND (${excludeSessionId ?? null}::uuid IS NULL OR cs.id <> ${excludeSessionId ?? null}::uuid)
        AND (
          cs.primary_instructor_id = ${instructorId}::uuid
          OR EXISTS (
            SELECT 1 FROM session_instructors si
            WHERE si.session_id = cs.id AND si.instructor_id = ${instructorId}::uuid
          )
        )
    ) AS overlap`
  return rows[0]?.overlap ?? false
}

/** instructorHasOverlap, as a guard: throws a clean 409 instead of returning true. */
export async function assertInstructorFree(
  tx: Prisma.TransactionClient,
  instructorId: string,
  startsAt: Date,
  endsAt: Date,
  excludeSessionId?: string,
): Promise<void> {
  if (await instructorHasOverlap(tx, instructorId, startsAt, endsAt, excludeSessionId)) {
    throw new ApiError(
      409,
      'instructor_conflict',
      'That instructor already has a session at this time.',
    )
  }
}

export interface LockedSession {
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  capacity: number
  primaryInstructorId: string
  roomId: string
}

/**
 * Locks a session row FOR UPDATE and returns its current state re-read under the
 * lock — the FIRST statement of any mutation that edits an existing session, so
 * a concurrent co-add / time-edit / another PATCH serializes behind it (closing
 * both the co-instructor double-book race and the lost-update race). 404 if the
 * session is gone.
 */
export async function lockSessionRow(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<LockedSession> {
  const rows = await tx.$queryRaw<
    {
      starts_at: Date
      ends_at: Date
      duration_minutes: number
      capacity: number
      primary_instructor_id: string
      room_id: string
    }[]
  >`SELECT starts_at, ends_at, duration_minutes, capacity, primary_instructor_id, room_id
      FROM class_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`
  const row = rows[0]
  if (!row) throw new ApiError(404, 'not_found', 'Session not found.')
  return {
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    primaryInstructorId: row.primary_instructor_id,
    roomId: row.room_id,
  }
}

/**
 * Locks the given instructors' user rows FOR UPDATE in ASCENDING uuid order
 * (deduplicated). A fixed lock order across every caller is what makes two
 * multi-instructor operations deadlock-free. A non-existent id simply locks
 * nothing — the caller's role/existence check is what rejects it. Always
 * called AFTER the session row lock (see the module note).
 */
export async function lockInstructorRows(
  tx: Prisma.TransactionClient,
  instructorIds: string[],
): Promise<void> {
  const ordered = [...new Set(instructorIds)].sort()
  for (const id of ordered) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`
  }
}
