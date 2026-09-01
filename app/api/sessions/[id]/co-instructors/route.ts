// app/api/sessions/[id]/co-instructors/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability, requireSessionView } from '@/server/authorization/guards'
import { coInstructorSchema } from '@/lib/schemas/domain'
import {
  addCoInstructor,
  readInstructorList,
  removeCoInstructor,
} from '@/server/domain/instructors'

/**
 * GET — the session's instructor roster (primary + co-instructors, names only).
 * SCOPED via requireSessionView: staff see any session; an instructor sees only
 * a session they teach (primary or co), and an out-of-scope/missing/malformed id
 * is a 404 (no existence leak) — Goal 5's "one list of every session where they
 * are the primary or a co-instructor" is the same scope.
 */
export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const { id } = await ctx.params
  await requireSessionView(req, id)
  return Response.json({ instructors: await readInstructorList(db(), id) })
})

/**
 * POST — add a co-instructor. STAFF only (coinstructor:manage, not the view
 * scope: teaching a session grants no right to manage its instructors — an
 * instructor can never add themselves or anyone else). Idempotent: re-adding an
 * existing co-instructor returns the current roster unchanged. The instructorId
 * is read from a .strict() body and passed explicitly — never spread.
 */
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'coinstructor:manage')
  const { id } = await ctx.params
  const { instructorId } = coInstructorSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ instructors: await addCoInstructor(db(), id, instructorId) })
})

/**
 * DELETE — remove a co-instructor. STAFF only. The instructorId travels in the
 * body (the path already names the session). Returns the updated roster (200);
 * removing an assignment that is not present is a 404. Never touches the session
 * itself or any booking history.
 */
export const DELETE = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'coinstructor:manage')
  const { id } = await ctx.params
  const { instructorId } = coInstructorSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ instructors: await removeCoInstructor(db(), id, instructorId) })
})
