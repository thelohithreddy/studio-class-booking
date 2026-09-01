// tests/integration/domain-sessions.test.ts
//
// Session scheduling: default inheritance, overrides, reference validation,
// the full conflict-interval matrix (room + instructor), edit re-validation,
// delete lifecycle, and concurrency. Driven against the real route handlers.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as sessionCreate } from '@app/api/sessions/route'
import { PATCH as sessionPatch, DELETE as sessionDelete } from '@app/api/sessions/[id]/route'

import { createPrismaClient } from '@/lib/db'
import { createSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { UserRole } from '@/generated/prisma/enums'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

let seq = 0
let staffCookie: string
let classId: string
let instructorId: string
let staffUserId: string
let roomId: string
let room2Id: string

async function makeUser(role: UserRole): Promise<string> {
  seq += 1
  const u = await prisma.user.create({
    data: {
      email: `sess-${role}-${seq}@x.test`,
      name: 'U',
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  return u.id
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `sess-staff-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffUserId = staff.id
  staffCookie = `studio_session=${(await createSession(staff.id)).token}`
  instructorId = await makeUser(UserRole.INSTRUCTOR)
  const klass = await prisma.class.create({
    data: {
      title: 'C',
      description: 'd',
      discipline: 'yoga',
      defaultDurationMinutes: 60,
      defaultCapacity: 20,
    },
  })
  classId = klass.id
  roomId = (await prisma.room.create({ data: { name: `room-${seq}` } })).id
  room2Id = (await prisma.room.create({ data: { name: `room2-${seq}` } })).id
})

function post(body: unknown, cookie = staffCookie): Request {
  return new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function patch(body: unknown, cookie = staffCookie): Request {
  return new Request('http://localhost/api/sessions/x', {
    method: 'PATCH',
    headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function base(overrides: Record<string, unknown> = {}) {
  return {
    classId,
    startsAt: '2026-09-07T10:00:00Z',
    primaryInstructorId: instructorId,
    roomId,
    ...overrides,
  }
}

async function createOk(overrides: Record<string, unknown> = {}) {
  const res = await sessionCreate(post(base(overrides)))
  expect(res.status).toBe(201)
  return (await res.json()) as {
    session: { id: string; durationMinutes: number; capacity: number; endsAt: string }
  }
}

// --- defaults + overrides ----------------------------------------------------

describe('default inheritance and overrides', () => {
  it('inherits class default duration and capacity when omitted', async () => {
    const { session } = await createOk()
    expect(session.durationMinutes).toBe(60)
    expect(session.capacity).toBe(20)
    // endsAt = start + 60min.
    expect(session.endsAt).toBe('2026-09-07T11:00:00.000Z')
  })

  it('keeps explicit overrides and recomputes endsAt', async () => {
    const { session } = await createOk({ durationMinutes: 90, capacity: 12 })
    expect(session.durationMinutes).toBe(90)
    expect(session.capacity).toBe(12)
    expect(session.endsAt).toBe('2026-09-07T11:30:00.000Z')
  })

  it('a later class-default change does not retroactively alter existing sessions', async () => {
    const { session } = await createOk()
    await prisma.class.update({ where: { id: classId }, data: { defaultDurationMinutes: 30 } })
    const reread = await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(reread.durationMinutes).toBe(60) // still the value resolved at creation
  })
})

// --- reference validation ----------------------------------------------------

describe('reference validation', () => {
  it('instructor cannot create a session (403)', async () => {
    const instructorCookie = `studio_session=${(await createSession(instructorId)).token}`
    expect((await sessionCreate(post(base(), instructorCookie))).status).toBe(403)
  })

  it('rejects a missing class (404)', async () => {
    expect(
      (await sessionCreate(post(base({ classId: '00000000-0000-4000-8000-000000000000' })))).status,
    ).toBe(404)
  })

  it('rejects scheduling on an archived class (409)', async () => {
    await prisma.class.update({ where: { id: classId }, data: { archivedAt: new Date() } })
    const res = await sessionCreate(post(base()))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('class_archived')
  })

  it('rejects a primary instructor who is not an INSTRUCTOR (422, role resolved server-side)', async () => {
    const res = await sessionCreate(post(base({ primaryInstructorId: staffUserId })))
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_an_instructor')
  })

  it('rejects a missing instructor (404) and a missing room (404)', async () => {
    expect(
      (
        await sessionCreate(
          post(base({ primaryInstructorId: '00000000-0000-4000-8000-000000000000' })),
        )
      ).status,
    ).toBe(404)
    expect(
      (await sessionCreate(post(base({ roomId: '00000000-0000-4000-8000-000000000000' })))).status,
    ).toBe(404)
  })
})

// --- conflict matrix (room and instructor) -----------------------------------

describe('conflict detection (half-open intervals)', () => {
  // existing session: 10:00–11:00.
  const conflictCases: Array<[string, string, number, boolean]> = [
    ['adjacent after 11:00–12:00', '2026-09-07T11:00:00Z', 60, false],
    ['adjacent before 09:00–10:00', '2026-09-07T09:00:00Z', 60, false],
    ['same start 10:00–11:00', '2026-09-07T10:00:00Z', 60, true],
    ['partial 10:59–11:59', '2026-09-07T10:59:00Z', 60, true],
    ['contained 10:15–10:45', '2026-09-07T10:15:00Z', 30, true],
    ['containing 09:30–11:30', '2026-09-07T09:30:00Z', 120, true],
  ]

  for (const [name, startsAt, durationMinutes, conflicts] of conflictCases) {
    it(`ROOM ${name} → ${conflicts ? '409' : '201'}`, async () => {
      await createOk() // 10:00–11:00 in roomId with instructorId
      // Second session, SAME room, DIFFERENT instructor (isolate the room conflict).
      const otherInstructor = await makeUser(UserRole.INSTRUCTOR)
      const res = await sessionCreate(
        post(base({ startsAt, durationMinutes, roomId, primaryInstructorId: otherInstructor })),
      )
      if (conflicts) {
        expect(res.status).toBe(409)
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('room_conflict')
      } else {
        expect(res.status).toBe(201)
      }
    })

    it(`INSTRUCTOR ${name} → ${conflicts ? '409' : '201'}`, async () => {
      await createOk()
      // Second session, SAME instructor, DIFFERENT room (isolate the instructor conflict).
      const res = await sessionCreate(
        post(
          base({ startsAt, durationMinutes, roomId: room2Id, primaryInstructorId: instructorId }),
        ),
      )
      if (conflicts) {
        expect(res.status).toBe(409)
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'instructor_conflict',
        )
      } else {
        expect(res.status).toBe(201)
      }
    })
  }
})

// --- edit ---------------------------------------------------------------------

describe('session edit', () => {
  it('re-runs conflict validation against the new time (excluding self)', async () => {
    const { session: a } = await createOk() // 10:00–11:00
    const otherInstructor = await makeUser(UserRole.INSTRUCTOR)
    await createOk({
      startsAt: '2026-09-07T12:00:00Z',
      roomId: room2Id,
      primaryInstructorId: otherInstructor,
    }) // 12:00–13:00

    // Editing A's own time in place is fine (self excluded).
    expect(
      (await sessionPatch(patch({ startsAt: '2026-09-07T10:30:00Z' }), ctx(a.id))).status,
    ).toBe(200)

    // Moving A onto the other session's room+time conflicts.
    const clash = await sessionPatch(
      patch({ startsAt: '2026-09-07T12:00:00Z', roomId: room2Id }),
      ctx(a.id),
    )
    expect(clash.status).toBe(409)
  })

  it('rejects assigning a STAFF user as primary instructor on edit (422)', async () => {
    const { session } = await createOk()
    const res = await sessionPatch(patch({ primaryInstructorId: staffUserId }), ctx(session.id))
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_an_instructor')
  })

  it('rejects shrinking capacity below the booked count (422)', async () => {
    const { session } = await createOk({ capacity: 10 })
    // Seed a booked count directly (the booking service is a later phase).
    const member = await prisma.member.create({
      data: {
        name: 'M',
        email: `cap-${seq}@x.test`,
        membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
      },
    })
    await prisma.booking.create({
      data: { sessionId: session.id, memberId: member.id, status: 'BOOKED' },
    })
    await prisma.classSession.update({ where: { id: session.id }, data: { bookedCount: 5 } })

    const res = await sessionPatch(patch({ capacity: 3 }), ctx(session.id))
    expect(res.status).toBe(422)
    expect(await res.text()).not.toMatch(/prisma|constraint|23514|P2039/i)
  })
})

// --- delete lifecycle --------------------------------------------------------

describe('session delete lifecycle', () => {
  it('deletes a session with no bookings (204)', async () => {
    const { session } = await createOk()
    expect((await sessionDelete(patch({}), ctx(session.id))).status).toBe(204)
    expect(await prisma.classSession.findUnique({ where: { id: session.id } })).toBeNull()
  })

  it('is idempotent under a double delete — the second is 404, not a 500', async () => {
    const { session } = await createOk()
    expect((await sessionDelete(patch({}), ctx(session.id))).status).toBe(204)
    const second = await sessionDelete(patch({}), ctx(session.id))
    expect(second.status).toBe(404)
    expect(await second.text()).not.toMatch(/prisma|P2025|500/i)
  })

  it('refuses to delete a session that has bookings (409), preserving history', async () => {
    const { session } = await createOk()
    const member = await prisma.member.create({
      data: {
        name: 'M',
        email: `del-${seq}@x.test`,
        membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
      },
    })
    await prisma.booking.create({
      data: { sessionId: session.id, memberId: member.id, status: 'BOOKED' },
    })

    const res = await sessionDelete(patch({}), ctx(session.id))
    expect(res.status).toBe(409)
    expect(await res.text()).not.toMatch(/prisma|foreign key|23503/i)
    // The session survived.
    expect(await prisma.classSession.findUnique({ where: { id: session.id } })).not.toBeNull()
  })
})

// --- concurrency -------------------------------------------------------------

describe('concurrent conflicting creation', () => {
  it('fires N simultaneous identical-slot creates → exactly one wins, DB holds one row', async () => {
    const N = 8
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => sessionCreate(post(base()))),
    )
    const statuses = await Promise.all(
      results.map(async (r) => (r.status === 'fulfilled' ? r.value.status : 500)),
    )
    const created = statuses.filter((s) => s === 201).length
    const conflicts = statuses.filter((s) => s === 409).length

    expect(created).toBe(1) // the exclusion constraint is the race-safe backstop
    expect(conflicts).toBe(N - 1) // losers get a clean 409, never a raw 500
    expect(statuses.filter((s) => s === 500)).toHaveLength(0)

    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM class_sessions WHERE room_id = $1`,
      [roomId],
    )
    expect(rows.rows[0].n).toBe(1)
  })
})

// --- malformed id ------------------------------------------------------------

describe('malformed ids', () => {
  it('a non-uuid session id is 404, not a 500 leak', async () => {
    const res = await sessionPatch(patch({ capacity: 5 }), ctx('not-a-uuid'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/prisma|P2007|uuid/i)
  })
})
