// app/api/bookings/[id]/settle/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { settleBookingSchema } from '@/lib/schemas/domain'
import { settleBooking } from '@/server/domain/bookings'

/**
 * POST /api/bookings/[id]/settle — staff records attendance for a BOOKED
 * booking once the session's start time has passed: ATTENDED or NO_SHOW.
 */
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const user = await requireCapability(req, 'booking:manage')
  const { id } = await ctx.params
  const { status, note } = settleBookingSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ booking: await settleBooking(db(), user, id, status, note) })
})
