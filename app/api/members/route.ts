// app/api/members/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { createMemberSchema, listQuerySchema } from '@/lib/schemas/domain'
import { createMember, listMembers } from '@/server/domain/members'

// GET /api/members — staff-only, bounded list (replaces the Phase-4 unbounded
// read). Paginated + searchable over name/email, server-side.
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'member:manage')
  const url = new URL(req.url)
  const { page, pageSize, q } = listQuerySchema.parse(Object.fromEntries(url.searchParams))
  return Response.json(await listMembers(db(), { page, pageSize, q }))
})

// POST /api/members — staff-only create. Members are not users (no auth).
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'member:manage')
  const input = createMemberSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ member: await createMember(db(), input) }, { status: 201 })
})
