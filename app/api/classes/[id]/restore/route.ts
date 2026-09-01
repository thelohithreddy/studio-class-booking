// app/api/classes/[id]/restore/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { restoreClass } from '@/server/domain/classes'

// POST /api/classes/[id]/restore — staff-only, idempotent.
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'class:manage')
  const { id } = await ctx.params
  return Response.json({ class: await restoreClass(db(), id) })
})
