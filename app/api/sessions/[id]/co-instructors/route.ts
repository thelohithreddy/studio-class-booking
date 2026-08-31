// app/api/sessions/[id]/co-instructors/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// POST/DELETE co-instructors — staff only (an instructor must never add
// themselves or assign another). Uses the capability guard, not the session
// view scope: relationship to the session grants no management right. Phase 6.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const POST = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'coinstructor:manage')
  return notImplemented('Adding co-instructors')
})
export const DELETE = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'coinstructor:manage')
  return notImplemented('Removing co-instructors')
})
