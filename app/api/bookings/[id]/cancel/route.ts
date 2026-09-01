// app/api/bookings/[id]/cancel/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { cancelBookingSchema } from '@/lib/schemas/domain'
import { cancelBooking } from '@/server/domain/bookings'

/**
 * POST /api/bookings/[id]/cancel — staff cancels a BOOKED or WAITLISTED
 * booking. Cancelling a BOOKED booking promotes the earliest waitlisted member
 * into the freed seat, atomically.
 */
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const user = await requireCapability(req, 'booking:manage')
  const { id } = await ctx.params
  const { note } = cancelBookingSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ booking: await cancelBooking(db(), user, id, note) })
})
