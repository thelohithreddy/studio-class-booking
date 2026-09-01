// app/api/sessions/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireUser } from '@/server/auth/session'
import { requireCapability } from '@/server/authorization/guards'
import { sessionScopeWhere } from '@/server/authorization/scope'
import { createSessionSchema, sessionListQuerySchema } from '@/lib/schemas/domain'
import { studioDateToUtc } from '@/server/domain/membership'
import type { Prisma } from '@/generated/prisma/client'
import { createSession } from '@/server/domain/sessions'

/**
 * GET /api/sessions — the caller's visible sessions (staff: all; instructor:
 * primary or co). An optional ?classId= filter is ANDed UNDER the scope, so an
 * instructor cannot use it to widen visibility. Rows and total share one WHERE.
 */
export const GET = handleRoute(async (req) => {
  const user = await requireUser(req)
  const { page, pageSize, classId, from, to } = sessionListQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams),
  )

  // A half-open [from, to) range on starts_at: `from` inclusive, `to` exclusive
  // (no end-of-day bug). The dates are interpreted as calendar days in the
  // studio's timezone (consistent with membership) — midnight studio-local,
  // converted to the matching UTC instant.
  const startsAtFilter: Prisma.DateTimeFilter = {}
  if (from) startsAtFilter.gte = studioDateToUtc(from)
  if (to) startsAtFilter.lt = studioDateToUtc(to)

  // Every filter is ANDed UNDER the scope, so it can only narrow an
  // instructor's visible set — never widen it.
  const where: Prisma.ClassSessionWhereInput = {
    AND: [
      sessionScopeWhere(user),
      ...(classId ? [{ classId }] : []),
      ...(from || to ? [{ startsAt: startsAtFilter }] : []),
    ],
  }

  // Bounded like the classes/members lists — a staff caller must not fetch
  // every session in one response.
  const [sessions, total] = await Promise.all([
    db().classSession.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        classId: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        bookedCount: true,
        roomId: true,
        primaryInstructorId: true,
        // Safe display relations (Goal 5) — no member/booking PII.
        class: { select: { title: true, discipline: true } },
        room: { select: { name: true } },
        primaryInstructor: { select: { id: true, name: true } },
      },
    }),
    db().classSession.count({ where }),
  ])

  return Response.json({ sessions, total, page, pageSize })
})

// POST /api/sessions — staff-only. Duration/capacity inherit class defaults when
// omitted; conflict validation runs for room and primary instructor.
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'session:manage')
  const input = createSessionSchema.parse(await req.json().catch(() => ({})))
  return Response.json({ session: await createSession(db(), input) }, { status: 201 })
})
