// src/server/domain/instructors.ts
import type { Db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import { parseIdOr404 } from '@/server/domain/ids'
import {
  assertInstructorFree,
  lockInstructorRows,
  lockSessionRow,
} from '@/server/domain/scheduling'

/**
 * Co-instructor management (Goal 5). Only studio staff reach these (the routes
 * gate add/remove behind coinstructor:manage; the read is scoped). The conflict
 * domain is the whole instructor schedule in ANY capacity, so a co-add funnels
 * through the same instructorHasOverlap predicate as create/edit, under the
 * uniform session→user lock order (see scheduling.ts).
 */

// Generous like the booking engine's — a burst on one session queues on its row
// lock; these transactions are a handful of short statements.
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

/** A session's instructor roster — names only, never email/hash (Goal 5 view). */
export interface InstructorList {
  primary: { id: string; name: string }
  coInstructors: { id: string; name: string }[]
}

/**
 * Reads the roster for a session: the primary plus co-instructors, ordered by
 * name. Callers that expose this to an instructor MUST scope the session first
 * (the routes use requireSessionView). 404 if the session is gone.
 */
export async function readInstructorList(db: Db, sessionId: string): Promise<InstructorList> {
  const session = await db.classSession.findUnique({
    where: { id: sessionId },
    select: {
      primaryInstructor: { select: { id: true, name: true } },
      coInstructors: {
        select: { instructor: { select: { id: true, name: true } } },
        orderBy: { instructor: { name: 'asc' } },
      },
    },
  })
  if (!session) throw new ApiError(404, 'not_found', 'Session not found.')
  return {
    primary: session.primaryInstructor,
    coInstructors: session.coInstructors.map((c) => c.instructor),
  }
}

/**
 * Adds a co-instructor to a session. Staff-only (guarded at the route).
 *
 * Order inside the transaction is load-bearing: lock the SESSION row first
 * (serializes against a concurrent time-edit that could move the interval out
 * from under this check — the co-instructor double-book race), then validate,
 * then lock the INSTRUCTOR's user row (serializes against creating/adding the
 * same instructor to an overlapping session elsewhere), then the overlap check,
 * then insert. The composite PK is the final race backstop.
 *
 * Idempotent: re-adding an existing co-instructor is a no-op that returns the
 * current roster (never a duplicate row, never an error).
 */
export async function addCoInstructor(
  db: Db,
  sessionId: string,
  instructorId: string,
): Promise<InstructorList> {
  const validSessionId = parseIdOr404(sessionId, 'Session not found.')
  await withDbErrors(
    () =>
      db.$transaction(async (tx) => {
        const session = await lockSessionRow(tx, validSessionId)

        const user = await tx.user.findUnique({
          where: { id: instructorId },
          select: { role: true },
        })
        if (!user) throw new ApiError(404, 'not_found', 'Instructor not found.')
        if (user.role !== 'INSTRUCTOR') {
          throw new ApiError(
            422,
            'not_an_instructor',
            'A co-instructor must have the instructor role.',
          )
        }
        // The primary instructor must not also be listed as a co-instructor.
        if (instructorId === session.primaryInstructorId) {
          throw new ApiError(
            422,
            'already_primary',
            'That instructor is already the primary instructor of this session.',
          )
        }

        // Lock the instructor's row before the overlap check so a concurrent add
        // of the same instructor to an overlapping session is serialized.
        await lockInstructorRows(tx, [instructorId])

        const already = await tx.sessionInstructor.findUnique({
          where: { sessionId_instructorId: { sessionId: validSessionId, instructorId } },
          select: { sessionId: true },
        })
        if (!already) {
          await assertInstructorFree(
            tx,
            instructorId,
            session.startsAt,
            session.endsAt,
            validSessionId,
          )
          await tx.sessionInstructor.create({
            data: { sessionId: validSessionId, instructorId },
          })
        }
      }, TX_OPTIONS),
    { conflict: 'That instructor is already assigned to this session.' },
  )
  // Read the roster AFTER the transaction commits, on the pooled client — a
  // nested-relation select inside an interactive transaction pipelines on the
  // single held connection (a pg deprecation), and this projection is display
  // data, not a raced-upon invariant.
  return readInstructorList(db, validSessionId)
}

/**
 * Removes a co-instructor from a session. Staff-only. Idempotent in the sense
 * that it never touches booking history or the session itself — but a request
 * to remove an assignment that is not there is a 404 (the relationship or the
 * session is absent). Removing a co can never CREATE a conflict, so no
 * instructor lock or overlap check is needed; the session-row lock only
 * serializes against a concurrent time-edit so the roster stays consistent.
 */
export async function removeCoInstructor(
  db: Db,
  sessionId: string,
  instructorId: string,
): Promise<InstructorList> {
  const validSessionId = parseIdOr404(sessionId, 'Session not found.')
  await db.$transaction(async (tx) => {
    await lockSessionRow(tx, validSessionId)
    const removed = await tx.sessionInstructor.deleteMany({
      where: { sessionId: validSessionId, instructorId },
    })
    if (removed.count === 0) {
      throw new ApiError(404, 'not_found', 'That co-instructor assignment was not found.')
    }
  }, TX_OPTIONS)
  return readInstructorList(db, validSessionId)
}
