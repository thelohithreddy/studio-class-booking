// app/api/classes/[id]/archive/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { archiveClass } from '@/server/domain/classes'

// POST /api/classes/[id]/archive — staff-only, idempotent. Non-destructive:
// sessions and bookings are untouched (RESTRICT FKs forbid their deletion).
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'class:manage')
  const { id } = await ctx.params
  return Response.json({ class: await archiveClass(db(), id) })
})
