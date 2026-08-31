// app/api/members/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

/**
 * GET /api/members — staff only. Member PII (name, email, expiry) is a
 * management surface the brief reserves for studio staff; an instructor gets
 * 403. The collection's existence is not secret (it is in the app's own JS) —
 * only its data is — so 403, not 404.
 */
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'member:manage')

  const members = await db().member.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, membershipExpiresOn: true },
  })

  return Response.json({ members })
})

// POST /api/members — add a member (staff only). Business logic: Phase 5.
// Binding rule for when implemented: zod .strict(), explicit field mapping,
// identity/role only from SessionUser.
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'member:manage')
  return notImplemented('Creating members')
})
