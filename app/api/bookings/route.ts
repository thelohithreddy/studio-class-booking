// app/api/bookings/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { requireUser } from '@/server/auth/session'
import { createBookingSchema, bookingListQuerySchema } from '@/lib/schemas/domain'
import { createBooking, listBookings } from '@/server/domain/bookings'

/**
 * GET /api/bookings — bookings the caller may see (staff: all; instructor:
 * bookings for sessions they teach). Minimal list for this phase: pagination +
 * optional session/status filter; the rich search/sort of Goal 6 is Phase 7.
 */
export const GET = handleRoute(async (req) => {
  const user = await requireUser(req)
  const params = bookingListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
  return Response.json(await listBookings(db(), user, params))
})

/**
 * POST /api/bookings — staff creates a booking for a member on a session. The
 * server decides BOOKED vs WAITLISTED from live capacity under a session lock;
 * an expired membership is rejected. Status/actor/bookedCount are never taken
 * from the body.
 */
export const POST = handleRoute(async (req) => {
  const user = await requireCapability(req, 'booking:manage')
  const input = createBookingSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ booking: await createBooking(db(), user, input) }, { status: 201 })
})
