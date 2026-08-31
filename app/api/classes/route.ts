// app/api/classes/route.ts
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// POST /api/classes — create a class (staff only). Business logic: Phase 5.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'class:manage')
  return notImplemented('Creating classes')
})
