// app/api/sessions/[id]/attendance/route.ts
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'

// GET /api/sessions/[id]/attendance — CSV export (staff only). The session id
// is authorized by the capability guard now; when Phase 7 implements the
// export it must ALSO scope to the requested session so this never becomes a
// data-exfiltration endpoint. Documented in architecture.md.
// Binding rule for when this is implemented (a GET — no request body):
// validate any query parameters through a zod schema, and take identity/role
// only from the SessionUser the guard returned.
export const GET = handleRoute<RouteContext<'id'>>(async (req) => {
  await requireCapability(req, 'attendance:export')
  return notImplemented('Attendance export')
})
