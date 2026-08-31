// app/api/auth/me/route.ts
import { handleRoute } from '@/lib/api/errors'
import { requireUser } from '@/server/auth/session'

/** GET /api/auth/me — the authenticated identity, or 401. Never cacheable. */
export const GET = handleRoute(async (req) => {
  const user = await requireUser(req)
  return Response.json({ user }, { headers: { 'Cache-Control': 'no-store' } })
})
