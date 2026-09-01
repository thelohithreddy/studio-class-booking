// app/api/dashboard/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { getDashboard } from '@/server/reporting/dashboard'

/**
 * GET /api/dashboard — studio-wide operational metrics (Goal 8). STAFF only
 * (dashboard:studio, decisions.md #17): the capability guard runs first, so a
 * non-staff caller (an instructor) is 403'd before any aggregation runs — this
 * global query is never reachable by a scoped role. There are NO query
 * parameters: the view is a fixed landing snapshot ("today"/"this week"/"last
 * eight weeks" are anchored to server time in the studio timezone), which
 * removes the filter-widening / parameter-pollution / SQLi-via-filter surfaces
 * entirely. Identity/role come only from the SessionUser the guard returned.
 */
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'dashboard:studio')
  return Response.json(await getDashboard(db()))
})
