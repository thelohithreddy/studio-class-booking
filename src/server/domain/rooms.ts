// src/server/domain/rooms.ts
import type { Db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import { parseIdOr404 } from '@/server/domain/ids'
import type { CreateRoomInput, UpdateRoomInput } from '@/lib/schemas/domain'

const ROOM_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const

// Rooms deliberately have no archive/retire lifecycle (the brief needs them as
// conflict-detection entities, not a room lifecycle) and no delete: a room a
// session references is RESTRICT-protected, so historical scheduling integrity
// is never destroyed. Documented in docs/decisions.md.

export function createRoom(db: Db, input: CreateRoomInput) {
  return withDbErrors(() => db.room.create({ data: { name: input.name }, select: ROOM_SELECT }), {
    conflict: 'A room with that name already exists.',
  })
}

export async function updateRoom(db: Db, id: string, input: UpdateRoomInput) {
  const validId = parseIdOr404(id, 'Room not found.')
  await requireRoom(db, validId)
  return withDbErrors(
    () =>
      db.room.update({ where: { id: validId }, data: { name: input.name }, select: ROOM_SELECT }),
    { conflict: 'A room with that name already exists.' },
  )
}

export async function getRoom(db: Db, id: string) {
  const room = await db.room.findUnique({
    where: { id: parseIdOr404(id, 'Room not found.') },
    select: ROOM_SELECT,
  })
  if (!room) throw new ApiError(404, 'not_found', 'Room not found.')
  return room
}

export async function listRooms(db: Db) {
  // Studios have tens of rooms; return all in a deterministic order, capped as
  // a safety bound.
  const rooms = await db.room.findMany({
    select: ROOM_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 500,
  })
  return { rooms }
}

async function requireRoom(db: Db, id: string) {
  const room = await db.room.findUnique({
    where: { id: parseIdOr404(id, 'Room not found.') },
    select: { id: true },
  })
  if (!room) throw new ApiError(404, 'not_found', 'Room not found.')
  return room
}
