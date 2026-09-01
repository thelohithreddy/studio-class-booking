// app/api/classes/[id]/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { updateClassSchema } from '@/lib/schemas/domain'
import { getClass, updateClass } from '@/server/domain/classes'

export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'class:manage')
  const { id } = await ctx.params
  return Response.json({ class: await getClass(db(), id) })
})

export const PATCH = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'class:manage')
  const { id } = await ctx.params
  const input = updateClassSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ class: await updateClass(db(), id, input) })
})
