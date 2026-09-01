// app/api/instructors/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { listInstructors } from '@/server/domain/instructor-directory'

/**
 * GET /api/instructors — the staff-facing instructor directory (id + name +
 * email) that powers the primary-instructor and co-instructor pickers, so a
 * UUID is never typed by hand. Gated on the existing STAFF-only
 * `session:manage` capability (every staff member who schedules a session needs
 * to choose its instructor); an INSTRUCTOR has no reason to enumerate peers and
 * gets 403. This is a read-only projection — no new mutation surface.
 */
export const GET = handleRoute(async (req) => {
  await requireCapability(req, 'session:manage')
  return Response.json(await listInstructors(db()))
})
