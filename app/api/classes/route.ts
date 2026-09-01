// app/api/classes/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { createClassSchema, listQuerySchema } from '@/lib/schemas/domain'
import { createClass, listClasses } from '@/server/domain/classes'

// GET /api/classes — staff-only list. Default excludes archived classes;
// ?includeArchived=true includes them. Paginated + searchable, server-side.
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'class:manage')
  const url = new URL(req.url)
  const { page, pageSize, q } = listQuerySchema.parse(Object.fromEntries(url.searchParams))
  const includeArchived = url.searchParams.get('includeArchived') === 'true'
  return Response.json(await listClasses(db(), { page, pageSize, q, includeArchived }))
})

// POST /api/classes — staff-only create.
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'class:manage')
  const input = createClassSchema.parse(await req.json().catch(() => ({})))
  const created = await createClass(db(), input)
  return Response.json({ class: created }, { status: 201 })
})
