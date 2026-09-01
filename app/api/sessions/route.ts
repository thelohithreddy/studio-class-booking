// app/api/sessions/route.ts
import { z } from 'zod'

import { db } from '@/lib/db'
import { ApiError, handleRoute } from '@/lib/api/errors'
import { requireUser } from '@/server/auth/session'
import { requireCapability } from '@/server/authorization/guards'
import { sessionScopeWhere } from '@/server/authorization/scope'
import { createSessionSchema, listQuerySchema } from '@/lib/schemas/domain'
import { createSession } from '@/server/domain/sessions'

/**
 * GET /api/sessions — the caller's visible sessions (staff: all; instructor:
 * primary or co). An optional ?classId= filter is ANDed UNDER the scope, so an
 * instructor cannot use it to widen visibility. Rows and total share one WHERE.
 */
export const GET = handleRoute(async (req) => {
  const user = await requireUser(req)
  const url = new URL(req.url)
  const { page, pageSize } = listQuerySchema.parse(Object.fromEntries(url.searchParams))
  const classIdRaw = url.searchParams.get('classId')?.trim() || undefined
  if (classIdRaw !== undefined && !z.string().uuid().safeParse(classIdRaw).success) {
    throw new ApiError(400, 'invalid_request', 'classId must be a valid id.')
  }

  // The classId filter is ANDed UNDER the scope, so it can only narrow an
  // instructor's visible set — never widen it.
  const where = {
    AND: [sessionScopeWhere(user), ...(classIdRaw ? [{ classId: classIdRaw }] : [])],
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
