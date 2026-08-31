// app/api/bookings/route.ts
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// POST /api/bookings — create a booking (staff only; an instructor cannot
// create bookings, Goal 1). Phase 6.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'booking:manage')
  return notImplemented('Creating bookings')
})
