// app/api/rooms/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { createRoomSchema } from '@/lib/schemas/domain'
import { createRoom, listRooms } from '@/server/domain/rooms'

export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'room:manage')
  return Response.json(await listRooms(db()))
})

export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'room:manage')
  const input = createRoomSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ room: await createRoom(db(), input) }, { status: 201 })
})
