// tests/integration/co-instructors.test.ts
//
// Co-instructor management (Goal 5) end to end: staff-only add/remove, scoped
// read, the FULL instructor conflict matrix (an instructor may not be in two
// overlapping sessions in ANY capacity — primary or co), and the Phase-8
// extension of the session edit path to re-check every instructor. Drives the
// real route handlers against real Postgres.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  GET as coList,
  POST as coAdd,
  DELETE as coRemove,
} from '@app/api/sessions/[id]/co-instructors/route'
import { POST as sessionCreate } from '@app/api/sessions/route'
import { PATCH as sessionPatch } from '@app/api/sessions/[id]/route'

import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'

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

async function newInstructor(): Promise<string> {
  seq += 1
  const u = await prisma.user.create({
    data: { email: `ci-i-${seq}@x.test`, name: `I${seq}`, role: 'INSTRUCTOR', passwordHash: 'x' },
  })
  return u.id
}

async function cookieFor(userId: string): Promise<string> {
  return `studio_session=${(await createAuthSession(userId)).token}`
}

interface MadeSession {
  id: string
  primaryId: string
  roomId: string
  classId: string
}

async function makeSession(opts: {
  startsAt: string
  durationMinutes?: number
  primaryId?: string
  roomId?: string
}): Promise<MadeSession> {
  seq += 1
  const primaryId = opts.primaryId ?? (await newInstructor())
  const c = await prisma.class.create({
    data: {
      title: `C${seq}`,
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: 10,
    },
  })
  const roomId = opts.roomId ?? (await prisma.room.create({ data: { name: `ci-r-${seq}` } })).id
  const dur = opts.durationMinutes ?? 60
  const startsAt = new Date(opts.startsAt)
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt,
      durationMinutes: dur,
      endsAt: new Date(startsAt.getTime() + dur * 60_000),
      capacity: 10,
      primaryInstructorId: primaryId,
      roomId,
    },
  })
  return { id: s.id, primaryId, roomId, classId: c.id }
}

function req(url: string, method: string, cookie: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

type Roster = {
  primary: { id: string; name: string }
  coInstructors: { id: string; name: string }[]
}
async function rosterOf(sessionId: string, cookie = staffCookie): Promise<Roster> {
  const res = await coList(
    req(`/api/sessions/${sessionId}/co-instructors`, 'GET', cookie),
    ctx(sessionId),
  )
  return ((await res.json()) as { instructors: Roster }).instructors
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `ci-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = await cookieFor(staff.id)
})

describe('co-instructor management (Goal 5)', () => {
  it('staff adds a co-instructor → 200, roster includes it (name only)', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const co = await newInstructor()
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
      ctx(s.id),
    )
    expect(res.status).toBe(200)
    const roster = ((await res.json()) as { instructors: Roster }).instructors
    expect(roster.coInstructors.map((c) => c.id)).toEqual([co])
    // Name only — never email/hash.
    expect(Object.keys(roster.coInstructors[0]!).sort()).toEqual(['id', 'name'])
  })

  it('a duplicate add is idempotent (200, no second row)', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const co = await newInstructor()
    const add = () =>
      coAdd(
        req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
        ctx(s.id),
      )
    expect((await add()).status).toBe(200)
    const second = await add()
    expect(second.status).toBe(200)
    expect((await rosterOf(s.id)).coInstructors).toHaveLength(1)
  })

  it('an instructor cannot add a co-instructor (403), even to their own session', async () => {
    const inst = await newInstructor()
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z', primaryId: inst })
    const other = await newInstructor()
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', await cookieFor(inst), {
        instructorId: other,
      }),
      ctx(s.id),
    )
    expect(res.status).toBe(403)
    expect((await rosterOf(s.id)).coInstructors).toHaveLength(0)
  })

  it('the primary instructor cannot also be a co-instructor (422)', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, {
        instructorId: s.primaryId,
      }),
      ctx(s.id),
    )
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('already_primary')
  })

  it('a non-instructor user cannot be a co-instructor (422)', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const notInstructor = await prisma.user.create({
      data: { email: `ci-x-${seq}@x.test`, name: 'X', role: 'STAFF', passwordHash: 'x' },
    })
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, {
        instructorId: notInstructor.id,
      }),
      ctx(s.id),
    )
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_an_instructor')
  })

  it('adding a non-existent instructor → 404; adding to a non-existent session → 404', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const ghost = '00000000-0000-0000-0000-000000000000'
    expect(
      (
        await coAdd(
          req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: ghost }),
          ctx(s.id),
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await coAdd(
          req(`/api/sessions/${ghost}/co-instructors`, 'POST', staffCookie, {
            instructorId: s.primaryId,
          }),
          ctx(ghost),
        )
      ).status,
    ).toBe(404)
  })

  it('remove is staff-only, idempotent-404 when absent, and drops read scope', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const co = await newInstructor()
    await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
      ctx(s.id),
    )

    // The co-instructor can read the roster (in scope).
    expect(
      (
        await coList(
          req(`/api/sessions/${s.id}/co-instructors`, 'GET', await cookieFor(co)),
          ctx(s.id),
        )
      ).status,
    ).toBe(200)

    // An instructor cannot remove (403).
    expect(
      (
        await coRemove(
          req(`/api/sessions/${s.id}/co-instructors`, 'DELETE', await cookieFor(co), {
            instructorId: co,
          }),
          ctx(s.id),
        )
      ).status,
    ).toBe(403)

    // Staff removes → 200, roster empty.
    const removed = await coRemove(
      req(`/api/sessions/${s.id}/co-instructors`, 'DELETE', staffCookie, { instructorId: co }),
      ctx(s.id),
    )
    expect(removed.status).toBe(200)
    expect(
      ((await removed.json()) as { instructors: Roster }).instructors.coInstructors,
    ).toHaveLength(0)

    // Removing again → 404 (relationship gone).
    expect(
      (
        await coRemove(
          req(`/api/sessions/${s.id}/co-instructors`, 'DELETE', staffCookie, { instructorId: co }),
          ctx(s.id),
        )
      ).status,
    ).toBe(404)

    // The removed instructor has LOST read scope → 404 (no existence leak).
    expect(
      (
        await coList(
          req(`/api/sessions/${s.id}/co-instructors`, 'GET', await cookieFor(co)),
          ctx(s.id),
        )
      ).status,
    ).toBe(404)
  })

  it('an unrelated instructor cannot read a session roster (404, no existence leak)', async () => {
    const s = await makeSession({ startsAt: '2027-01-05T10:00:00Z' })
    const stranger = await newInstructor()
    expect(
      (
        await coList(
          req(`/api/sessions/${s.id}/co-instructors`, 'GET', await cookieFor(stranger)),
          ctx(s.id),
        )
      ).status,
    ).toBe(404)
  })
})

describe('conflict matrix — an instructor is one person across all their sessions', () => {
  it('co-add conflicts when the instructor is PRIMARY of an overlapping session (409)', async () => {
    const s = await makeSession({ startsAt: '2027-02-01T10:00:00Z' })
    const busy = await newInstructor()
    await makeSession({ startsAt: '2027-02-01T10:30:00Z', primaryId: busy }) // overlaps s
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: busy }),
      ctx(s.id),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'instructor_conflict',
    )
  })

  it('co-add conflicts when the instructor is CO of an overlapping session (409)', async () => {
    const s = await makeSession({ startsAt: '2027-02-01T10:00:00Z' })
    const busy = await newInstructor()
    const other = await makeSession({ startsAt: '2027-02-01T10:30:00Z' }) // overlaps s
    await prisma.sessionInstructor.create({ data: { sessionId: other.id, instructorId: busy } })
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: busy }),
      ctx(s.id),
    )
    expect(res.status).toBe(409)
  })

  it('co-add is allowed for a back-to-back (adjacent) session — half-open intervals', async () => {
    const s = await makeSession({ startsAt: '2027-02-01T10:00:00Z' }) // [10:00, 11:00)
    const adj = await newInstructor()
    await makeSession({ startsAt: '2027-02-01T11:00:00Z', primaryId: adj }) // [11:00, 12:00) — touches, no overlap
    const res = await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: adj }),
      ctx(s.id),
    )
    expect(res.status).toBe(200)
  })

  it('the same instructor may co-teach two overlapping sessions only if... it cannot (any capacity)', async () => {
    // Add co to A, then adding the same co to an overlapping B is rejected.
    const co = await newInstructor()
    const a = await makeSession({ startsAt: '2027-02-01T10:00:00Z' })
    const b = await makeSession({ startsAt: '2027-02-01T10:30:00Z' })
    expect(
      (
        await coAdd(
          req(`/api/sessions/${a.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
          ctx(a.id),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await coAdd(
          req(`/api/sessions/${b.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
          ctx(b.id),
        )
      ).status,
    ).toBe(409)
  })

  it('creating a session whose PRIMARY is a co of an overlapping session → 409 (F1: create checks the co axis)', async () => {
    const busy = await newInstructor()
    const existing = await makeSession({ startsAt: '2027-03-01T10:00:00Z' })
    await prisma.sessionInstructor.create({ data: { sessionId: existing.id, instructorId: busy } })
    // Now create a NEW session with primary = busy at an overlapping time.
    const klass = await prisma.class.create({
      data: {
        title: 'New',
        description: 'd',
        discipline: 'y',
        defaultDurationMinutes: 60,
        defaultCapacity: 10,
      },
    })
    const room = await prisma.room.create({ data: { name: `ci-cr-${seq}` } })
    const res = await sessionCreate(
      req('/api/sessions', 'POST', staffCookie, {
        classId: klass.id,
        startsAt: '2027-03-01T10:30:00Z',
        primaryInstructorId: busy,
        roomId: room.id,
      }),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'instructor_conflict',
    )
  })
})

describe('session edit path re-checks ALL instructors (Phase-8 extension of updateSession)', () => {
  it('a TIME edit re-checks a co-instructor against the new window (409)', async () => {
    const s = await makeSession({ startsAt: '2027-04-01T10:00:00Z' }) // [10:00,11:00)
    const co = await newInstructor()
    await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
      ctx(s.id),
    )
    // co is busy elsewhere at 14:00 (as primary).
    await makeSession({ startsAt: '2027-04-01T14:00:00Z', primaryId: co })
    // Moving s onto 14:00 must be rejected because its co is busy then.
    const res = await sessionPatch(
      req(`/api/sessions/${s.id}`, 'PATCH', staffCookie, { startsAt: '2027-04-01T14:00:00Z' }),
      ctx(s.id),
    )
    expect(res.status).toBe(409)
    // A move to a free time still works.
    expect(
      (
        await sessionPatch(
          req(`/api/sessions/${s.id}`, 'PATCH', staffCookie, { startsAt: '2027-04-01T16:00:00Z' }),
          ctx(s.id),
        )
      ).status,
    ).toBe(200)
  })

  it('a PRIMARY change re-checks the new primary against their co commitments (409)', async () => {
    const s = await makeSession({ startsAt: '2027-04-02T10:00:00Z' })
    const j = await newInstructor()
    // j is a co of an overlapping session.
    const other = await makeSession({ startsAt: '2027-04-02T10:30:00Z' })
    await prisma.sessionInstructor.create({ data: { sessionId: other.id, instructorId: j } })
    const res = await sessionPatch(
      req(`/api/sessions/${s.id}`, 'PATCH', staffCookie, { primaryInstructorId: j }),
      ctx(s.id),
    )
    expect(res.status).toBe(409)
  })

  it('promoting a current co-instructor to primary is rejected (422 already_co)', async () => {
    const s = await makeSession({ startsAt: '2027-04-03T10:00:00Z' })
    const co = await newInstructor()
    await coAdd(
      req(`/api/sessions/${s.id}/co-instructors`, 'POST', staffCookie, { instructorId: co }),
      ctx(s.id),
    )
    const res = await sessionPatch(
      req(`/api/sessions/${s.id}`, 'PATCH', staffCookie, { primaryInstructorId: co }),
      ctx(s.id),
    )
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('already_co')
  })
})
