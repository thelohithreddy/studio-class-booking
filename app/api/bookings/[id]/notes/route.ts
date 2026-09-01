// app/api/bookings/[id]/notes/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { addNoteSchema } from '@/lib/schemas/domain'
import { addBookingNote } from '@/server/domain/bookings'

/**
 * POST /api/bookings/[id]/notes — staff appends a note to a booking's timeline
 * (Goal 9) without a status change. The note lands as an immutable NOTE_ADDED
 * event and can never be edited or deleted afterward.
 */
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const user = await requireCapability(req, 'booking:manage')
  const { id } = await ctx.params
  const { note } = addNoteSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ booking: await addBookingNote(db(), user, id, note) }, { status: 201 })
})
