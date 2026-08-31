// app/api/sessions/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireUser } from '@/server/auth/session'
import { requireCapability } from '@/server/authorization/guards'
import { notImplemented } from '@/server/authorization/not-implemented'
import { sessionScopeWhere } from '@/server/authorization/scope'

/**
 * GET /api/sessions — the caller's visible sessions.
 *
 * Both the rows and the total are computed under the SAME scope fragment, so
 * the count can never report sessions the viewer may not see. Staff get every
 * session; an instructor gets exactly those they teach (primary or co). This
 * is the reference shape for every future scoped collection
 * (authorize-scope → DB filter → count → later: sort/paginate).
 */
export const GET = handleRoute(async (req) => {
  const user = await requireUser(req)
  const where = sessionScopeWhere(user)

  const [sessions, total] = await Promise.all([
    db().classSession.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        roomId: true,
        primaryInstructorId: true,
        classId: true,
      },
    }),
    db().classSession.count({ where }),
  ])

  return Response.json({ sessions, total })
})

// POST /api/sessions — schedule a session (staff only). Business logic: Phase 5.
// Binding rule for when this is implemented: parse the body through a zod
// .strict() schema, map fields to Prisma explicitly, and take identity/role
// only from the SessionUser the guard returned — never spread req.json().
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'session:manage')
  return notImplemented('Creating sessions')
})
