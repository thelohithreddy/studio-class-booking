// app/api/sessions/[id]/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability, requireSessionView } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

/**
 * GET /api/sessions/[id] — one session, only if the caller may see it.
 *
 * A single scoped read: the display projection and the authorization predicate
 * (sessionScopeWhere) travel in the same query, so there is no second round
 * trip and no TOCTOU window. A missing row, an out-of-scope-but-existing
 * session (an instructor cannot confirm another's exists), and a malformed id
 * all resolve to the same 404. The select is scalar session fields only — no
 * member/booking relations — so an instructor-visible read cannot carry PII.
 */
export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const { id } = await ctx.params
  const { session } = await requireSessionView(req, id)
  return Response.json({ session })
})

// PATCH/DELETE /api/sessions/[id] — edit/delete a session (STAFF only). These
// use the capability guard, not requireSessionView: an instructor who teaches
// the session still cannot mutate it — only staff can. Business logic: Phase 5.
// Binding rule for when implemented: zod .strict(), explicit field mapping,
// identity/role only from SessionUser.
export const PATCH = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'session:manage')
  return notImplemented('Editing sessions')
})

export const DELETE = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'session:manage')
  return notImplemented('Deleting sessions')
})
