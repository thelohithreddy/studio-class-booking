// app/api/members/[id]/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { updateMemberSchema } from '@/lib/schemas/domain'
import { getMember, updateMember } from '@/server/domain/members'

export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'member:manage')
  const { id } = await ctx.params
  return Response.json({ member: await getMember(db(), id) })
})

// PATCH /api/members/[id] — staff-only. Editing membership expiry persists the
// value the later alert lifecycle reads; no alert/dismissal logic here.
export const PATCH = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'member:manage')
  const { id } = await ctx.params
  const input = updateMemberSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ member: await updateMember(db(), id, input) })
})
