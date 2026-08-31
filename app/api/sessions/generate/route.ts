// app/api/sessions/generate/route.ts
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// POST /api/sessions/generate — recurring generation (staff only). Phase 7.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'recurring:generate')
  return notImplemented('Generating recurring sessions')
})
