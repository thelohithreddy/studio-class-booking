// app/api/members/[id]/alert-dismiss/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// POST /api/members/[id]/alert-dismiss — dismiss a membership-expiry alert
// (staff only, Goal 10). Guards the alert:dismiss capability now so the attack
// matrix covers every declared verb; the dismissal record lands in Phase 9.
// Binding rule for when implemented: zod .strict(), explicit field mapping,
// identity/role only from SessionUser.
export const POST = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'alert:dismiss')
  return notImplemented('Dismissing membership alerts')
})
