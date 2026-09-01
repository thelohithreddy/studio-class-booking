// app/api/sessions/[id]/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability, requireSessionView } from '@/server/authorization/guards'
import { updateSessionSchema } from '@/lib/schemas/domain'
import { deleteSession, updateSession } from '@/server/domain/sessions'

/**
 * GET /api/sessions/[id] — one session, only if the caller may see it (scoped
 * read, 404 for out-of-scope/missing/malformed id — Phase 4).
 */
export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const { id } = await ctx.params
  const { session } = await requireSessionView(req, id)
  return Response.json({ session })
})

/**
 * PATCH /api/sessions/[id] — STAFF only (session:manage, not view scope: an
 * instructor who teaches the session still cannot edit it). Re-runs conflict
 * validation against the new values.
 */
export const PATCH = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'session:manage')
  const { id } = await ctx.params
  const input = updateSessionSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ session: await updateSession(db(), id, input) })
})

/**
 * DELETE /api/sessions/[id] — STAFF only. Succeeds only for a session with no
 * bookings; a booked session is permanently undeletable (409).
 */
export const DELETE = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'session:manage')
  const { id } = await ctx.params
  await deleteSession(db(), id)
  return new Response(null, { status: 204 })
})
