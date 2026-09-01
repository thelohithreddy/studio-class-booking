// app/api/rooms/[id]/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { updateRoomSchema } from '@/lib/schemas/domain'
import { getRoom, updateRoom } from '@/server/domain/rooms'

export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'room:manage')
  const { id } = await ctx.params
  return Response.json({ room: await getRoom(db(), id) })
})

export const PATCH = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'room:manage')
  const { id } = await ctx.params
  const input = updateRoomSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ room: await updateRoom(db(), id, input) })
})
