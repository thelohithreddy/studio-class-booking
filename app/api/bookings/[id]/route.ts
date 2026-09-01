// app/api/bookings/[id]/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireUser } from '@/server/auth/session'
import { getBooking } from '@/server/domain/bookings'

/**
 * GET /api/bookings/[id] — one booking and its immutable timeline, only if the
 * caller may see its session (404 otherwise — no existence leak).
 */
export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const user = await requireUser(req)
  const { id } = await ctx.params
  return Response.json({ booking: await getBooking(db(), user, id) })
})
