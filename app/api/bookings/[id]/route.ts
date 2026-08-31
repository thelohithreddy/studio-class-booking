// app/api/bookings/[id]/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// PATCH /api/bookings/[id] — cancel/settle a booking (staff only). Phase 6.
// Binding rule for when this is implemented: parse the body through a
// zod .strict() schema, map fields to Prisma explicitly, and take identity/
// role only from the SessionUser the guard returned — never spread req.json().
export const PATCH = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'booking:manage')
  return notImplemented('Updating bookings')
})
