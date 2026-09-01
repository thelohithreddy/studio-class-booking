// tests/integration/coinstructor-concurrency.test.ts
//
// The Phase-8 concurrency matrix: real concurrent route calls against real
// Postgres, asserting the FINAL DATABASE STATE, repeated across trials. The
// session→user lock order (scheduling.ts) is what makes these pass; a naive
// check-then-insert would double-book an instructor here. The headline invariant
// — NO instructor is ever in two overlapping sessions in ANY capacity — is
// asserted after every scenario by a single cross-join query over the union of
// primary and co-instructor intervals.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as coAdd } from '@app/api/sessions/[id]/co-instructors/route'
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
  return (
    await prisma.user.create({
      data: { email: `cc-i-${seq}@x.test`, name: `I${seq}`, role: 'INSTRUCTOR', passwordHash: 'x' },
    })
  ).id
}

async function makeSession(opts: {
  startsAt: string
  durationMinutes?: number
  primaryId?: string
}): Promise<{ id: string; primaryId: string; classId: string; roomId: string }> {
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
  const roomId = (await prisma.room.create({ data: { name: `cc-r-${seq}` } })).id
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
  return { id: s.id, primaryId, classId: c.id, roomId }
}

function coReq(sessionId: string, instructorId: string): Request {
  return new Request(`http://localhost/api/sessions/${sessionId}/co-instructors`, {
    method: 'POST',
    headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ instructorId }),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const addCo = (sessionId: string, instructorId: string) =>
  coAdd(coReq(sessionId, instructorId), ctx(sessionId))

/** The core invariant: no instructor overlaps themselves across all capacities. */
async function assertNoInstructorDoubleBooked() {
  const res = await pool.query(`
    WITH intervals AS (
      SELECT primary_instructor_id AS instructor_id, starts_at, ends_at, id FROM class_sessions
      UNION ALL
      SELECT si.instructor_id, cs.starts_at, cs.ends_at, cs.id
        FROM session_instructors si JOIN class_sessions cs ON cs.id = si.session_id
    )
    SELECT count(*)::int AS n FROM intervals a JOIN intervals b
      ON a.instructor_id = b.instructor_id AND a.id <> b.id
     AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at`)
  expect(res.rows[0].n).toBe(0)
}

async function coCountFor(instructorId: string): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int n FROM session_instructors WHERE instructor_id=$1`,
    [instructorId],
  )
  return res.rows[0].n
}

/** Truncates everything AND re-establishes a valid staff session (truncateAll
 * wipes users + auth sessions, so the cookie must be re-minted after each). */
async function reset() {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `cc-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
}

beforeEach(reset)

describe('co-instructor concurrency matrix (final-state assertions, real Postgres)', () => {
  it('TEST A — same instructor added to two overlapping sessions at once → exactly one wins', async () => {
    for (let trial = 0; trial < 4; trial += 1) {
      await reset()
      const inst = await newInstructor()
      const a = await makeSession({ startsAt: '2027-05-01T10:00:00Z' })
      const b = await makeSession({ startsAt: '2027-05-01T10:30:00Z' }) // overlaps a
      const [ra, rb] = await Promise.all([addCo(a.id, inst), addCo(b.id, inst)])
      const statuses = [ra.status, rb.status].sort()
      expect(statuses).toEqual([200, 409]) // one succeeds, one conflicts
      expect(await coCountFor(inst)).toBe(1) // in exactly one
      await assertNoInstructorDoubleBooked()
    }
  })

  it('TEST B — co-add races a create that makes the same instructor a primary of an overlapping session → one wins', async () => {
    for (let trial = 0; trial < 4; trial += 1) {
      await reset()
      const inst = await newInstructor()
      const existing = await makeSession({ startsAt: '2027-05-02T10:00:00Z' })
      const klass = await prisma.class.create({
        data: {
          title: 'K',
          description: 'd',
          discipline: 'y',
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
        },
      })
      const room = await prisma.room.create({ data: { name: `cc-b-${seq}-${trial}` } })
      const createReq = new Request('http://localhost/api/sessions', {
        method: 'POST',
        headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          classId: klass.id,
          startsAt: '2027-05-02T10:30:00Z', // overlaps `existing`
          primaryInstructorId: inst,
          roomId: room.id,
        }),
      })
      const [rCo, rCreate] = await Promise.all([addCo(existing.id, inst), sessionCreate(createReq)])
      // At most one places `inst` into the overlapping window; the other conflicts.
      const ok = [rCo.status === 200, rCreate.status === 201].filter(Boolean).length
      expect(ok).toBe(1)
      await assertNoInstructorDoubleBooked()
    }
  })

  it('TEST C — co-add races a time-edit that moves the session onto the co-instructor’s busy slot (the F2 race)', async () => {
    for (let trial = 0; trial < 6; trial += 1) {
      await reset()
      const c2 = await newInstructor()
      // c2 is busy at 12:00 (primary of B).
      const b = await makeSession({ startsAt: '2027-05-03T12:00:00Z', primaryId: c2 })
      // Session S is at 10:00 (c2 free then).
      const s = await makeSession({ startsAt: '2027-05-03T10:00:00Z' })
      const patchReq = new Request(`http://localhost/api/sessions/${s.id}`, {
        method: 'PATCH',
        headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ startsAt: '2027-05-03T12:00:00Z' }), // onto c2's busy slot
      })
      // Race: add c2 as co of S, and move S onto 12:00.
      await Promise.all([addCo(s.id, c2), sessionPatch(patchReq, ctx(s.id))])
      // Whatever the interleaving, c2 must NOT end up double-booked — i.e. never
      // a co of S while S overlaps B. The global invariant proves it.
      await assertNoInstructorDoubleBooked()
      void b
    }
  })

  it('TEST D — one instructor added to three mutually-overlapping sessions at once → exactly one wins', async () => {
    const inst = await newInstructor()
    const a = await makeSession({ startsAt: '2027-05-04T10:00:00Z' })
    const b = await makeSession({ startsAt: '2027-05-04T10:15:00Z' })
    const c = await makeSession({ startsAt: '2027-05-04T10:30:00Z' })
    const results = await Promise.all([addCo(a.id, inst), addCo(b.id, inst), addCo(c.id, inst)])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(2)
    expect(await coCountFor(inst)).toBe(1)
    await assertNoInstructorDoubleBooked()
  })

  it('TEST E — back-to-back sessions, concurrent adds → BOTH succeed (half-open, no conflict)', async () => {
    const inst = await newInstructor()
    const a = await makeSession({ startsAt: '2027-05-05T10:00:00Z' }) // [10,11)
    const b = await makeSession({ startsAt: '2027-05-05T11:00:00Z' }) // [11,12)
    const [ra, rb] = await Promise.all([addCo(a.id, inst), addCo(b.id, inst)])
    expect([ra.status, rb.status]).toEqual([200, 200])
    expect(await coCountFor(inst)).toBe(2)
    await assertNoInstructorDoubleBooked()
  })

  it('TEST F — different instructors, same time → both succeed', async () => {
    const i1 = await newInstructor()
    const i2 = await newInstructor()
    const a = await makeSession({ startsAt: '2027-05-06T10:00:00Z' })
    const b = await makeSession({ startsAt: '2027-05-06T10:00:00Z' })
    const [ra, rb] = await Promise.all([addCo(a.id, i1), addCo(b.id, i2)])
    expect([ra.status, rb.status]).toEqual([200, 200])
    await assertNoInstructorDoubleBooked()
  })

  it('DEADLOCK — two multi-instructor time-edits with crossed instructor sets do not deadlock', async () => {
    // S1 has cos [X, Y]; S2 has cos [Y, X] — the two edits touch the same
    // instructor set in opposite input order. Sorted locking (lockInstructorRows)
    // makes them take X and Y in the SAME order, so neither deadlocks.
    const x = await newInstructor()
    const y = await newInstructor()
    const s1 = await makeSession({ startsAt: '2027-05-07T10:00:00Z' })
    const s2 = await makeSession({ startsAt: '2027-05-07T14:00:00Z' })
    await prisma.sessionInstructor.createMany({
      data: [
        { sessionId: s1.id, instructorId: x },
        { sessionId: s1.id, instructorId: y },
        { sessionId: s2.id, instructorId: y },
        { sessionId: s2.id, instructorId: x },
      ],
    })
    // Move each session to a fresh, mutually free slot (no real conflict — the
    // point is the LOCK order, not the overlap result).
    const patch = (id: string, startsAt: string) =>
      sessionPatch(
        new Request(`http://localhost/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ startsAt }),
        }),
        ctx(id),
      )
    const [r1, r2] = await Promise.all([
      patch(s1.id, '2027-05-07T20:00:00Z'),
      patch(s2.id, '2027-05-07T22:00:00Z'),
    ])
    // Neither is a 500 (a deadlock would surface as a scrubbed 500); both succeed.
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    await assertNoInstructorDoubleBooked()
  })
})
