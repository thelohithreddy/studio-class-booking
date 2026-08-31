// app/api/classes/[id]/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// PATCH /api/classes/[id] — edit/archive/restore a class (staff only). Phase 5.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const PATCH = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'class:manage')
  return notImplemented('Editing classes')
})
