// app/api/members/alerts/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { listMembershipAlerts } from '@/server/domain/alerts'

/**
 * GET /api/members/alerts — members whose membership is expired or expiring within
 * seven days and whose current expiry has not been dismissed (Goal 10). STAFF only
 * (member:manage — reading member expiry data, the same gate as the members list):
 * an instructor 403s. There are NO query parameters (a fixed alerts list), so there
 * is no filter-widening / parameter-pollution / SQLi-via-filter surface. no-store
 * (handleRoute default) — the "expiring soon" set is date- and identity-sensitive
 * and must never be cached across users or across dates.
 *
 * (A static segment, so it resolves ahead of the dynamic /api/members/[id].)
 */
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'member:manage')
  return Response.json(await listMembershipAlerts(db()))
})
