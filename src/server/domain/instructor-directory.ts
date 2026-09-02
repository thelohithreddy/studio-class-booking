// src/server/domain/instructor-directory.ts
import type { Db } from '@/lib/db'

const INSTRUCTOR_SELECT = { id: true, name: true, email: true } as const

/**
 * Every user who may be assigned as a session's primary instructor or a
 * co-instructor — i.e. role INSTRUCTOR. STAFF-only read (gated at the route):
 * it exists purely so the staff-facing UI can offer a name-based instructor
 * picker instead of asking anyone to type a UUID. Deterministic order, capped
 * as a safety bound (a studio has tens of instructors, not thousands).
 *
 * Distinct from domain/instructors.ts, which manages a session's co-instructor
 * roster; this is a flat directory of instructor identities for selection.
 */
export async function listInstructors(db: Db) {
  const instructors = await db.user.findMany({
    where: { role: 'INSTRUCTOR' },
    select: INSTRUCTOR_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 500,
  })
  return { instructors }
}
