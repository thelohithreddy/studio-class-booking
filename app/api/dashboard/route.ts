// app/api/dashboard/route.ts
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// GET /api/dashboard — studio-wide metrics (staff only). Any future instructor
// dashboard must be a separate, scope-filtered query — never this global one.
// Phase 8.
// Binding rule for when this is implemented (a GET — no request body):
// validate any query parameters through a zod schema, and take identity/role
// only from the SessionUser the guard returned.
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'dashboard:studio')
  return notImplemented('Dashboard metrics')
})
