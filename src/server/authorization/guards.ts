// src/server/authorization/guards.ts
import { z } from 'zod'

import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { requireUser, type SessionUser } from '@/server/auth/session'
import { can, type Capability } from '@/server/authorization/policy'
import { sessionScopeWhere } from '@/server/authorization/scope'

/**
 * The authorization pipeline, in three composable guards. Every one FAILS
 * CLOSED: it throws an ApiError rather than returning a decision, so nothing
 * downstream runs without an authorized identity in hand, and an unexpected
 * throw becomes handleRoute's generic 500 — never an ALLOW.
 */

/** Authenticated + role permits the verb, or 403. Identity is server-resolved. */
export async function requireCapability(
  req: Request,
  capability: Capability,
): Promise<SessionUser> {
  const user = await requireUser(req) // 401 if unauthenticated
  if (!can(user, capability)) {
    // Generic: the body never names the capability or the caller's role.
    throw new ApiError(403, 'forbidden', 'You do not have permission to perform this action.')
  }
  return user
}

const uuid = z.string().uuid()

/**
 * The display projection returned by requireSessionView — scalar session fields
 * only. No member/booking relation includes, so an instructor-visible read can
 * never carry member PII inside an otherwise-authorized payload.
 */
const SESSION_VIEW_SELECT = {
  id: true,
  classId: true,
  startsAt: true,
  endsAt: true,
  durationMinutes: true,
  capacity: true,
  bookedCount: true,
  primaryInstructorId: true,
  roomId: true,
  // Safe display relations (Goal 5's "my sessions" needs names, not UUIDs).
  // class title/discipline, room name and instructor name are not PII; member
  // and booking relations are deliberately excluded.
  class: { select: { title: true, discipline: true } },
  room: { select: { name: true } },
  primaryInstructor: { select: { id: true, name: true } },
} as const

export type SessionView = Prisma.ClassSessionGetPayload<{ select: typeof SESSION_VIEW_SELECT }>

/**
 * Authenticated + the requested session is within the caller's scope; returns
 * the authorized session row, or throws 404.
 *
 * A single scoped read: the authorization predicate (sessionScopeWhere) and the
 * display projection travel in the same query, so an unauthorized row is never
 * fetched and there is no second round trip (no TOCTOU window where the row
 * could vanish between an access check and a re-read).
 *
 * 404 — not 403 — for an out-of-scope-but-existing session: an instructor must
 * not be able to confirm another instructor's session exists by its id. A
 * malformed id resolves to the same 404 (a non-uuid cannot name a row, and
 * validating it here also keeps Prisma's invalid-uuid error — P2007 on the pg
 * adapter — from surfacing as a 500).
 */
export async function requireSessionView(
  req: Request,
  rawId: string,
): Promise<{ user: SessionUser; session: SessionView }> {
  const user = await requireUser(req)

  const parsed = uuid.safeParse(rawId)
  const session = parsed.success
    ? await db().classSession.findFirst({
        where: { AND: [{ id: parsed.data }, sessionScopeWhere(user)] },
        select: SESSION_VIEW_SELECT,
      })
    : null
  if (!session) throw new ApiError(404, 'not_found', 'Session not found.')

  return { user, session }
}
