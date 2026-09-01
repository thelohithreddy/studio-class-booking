// tests/integration/authorization.test.ts
//
// The Phase 4 authorization matrix, driven directly against the route handlers
// in-process — the UI is never involved, so these prove the SERVER is the
// authority. Actors:
//   unauthenticated · STAFF · instructor A (primary of S1, co of S2) ·
//   instructor B (primary of S2, unrelated to S1) · instructor C (no sessions)
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as sessionsList, POST as sessionsCreate } from '@app/api/sessions/route'
import {
  GET as sessionGet,
  PATCH as sessionPatch,
  DELETE as sessionDelete,
} from '@app/api/sessions/[id]/route'
import { GET as membersList, POST as membersCreate } from '@app/api/members/route'
import { PATCH as memberPatch } from '@app/api/members/[id]/route'
import { POST as classCreate } from '@app/api/classes/route'
import { PATCH as classPatch } from '@app/api/classes/[id]/route'
import {
  POST as coInstructorAdd,
  DELETE as coInstructorRemove,
} from '@app/api/sessions/[id]/co-instructors/route'
import { POST as generate } from '@app/api/sessions/generate/route'
import { GET as attendance } from '@app/api/sessions/[id]/attendance/route'
import { POST as bookingCreate } from '@app/api/bookings/route'
import { POST as bookingCancel } from '@app/api/bookings/[id]/cancel/route'
import { POST as bookingSettle } from '@app/api/bookings/[id]/settle/route'
import { POST as bookingNote } from '@app/api/bookings/[id]/notes/route'
import { GET as dashboard } from '@app/api/dashboard/route'
import { POST as alertDismiss } from '@app/api/members/[id]/alert-dismiss/route'

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

// --- fixtures ----------------------------------------------------------------

interface World {
  staffCookie: string
  aCookie: string // instructor A: primary S1, co S2
  bCookie: string // instructor B: primary S2, unrelated to S1
  cCookie: string // instructor C: no sessions
  s1: string
  s2: string
  aId: string
  memberId: string
}

let seq = 0
async function makeUser(role: UserRole): Promise<{ id: string; cookie: string }> {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `authz-${role}-${seq}@studio.test`,
      name: `${role} ${seq}`,
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  const { token } = await createSession(user.id)
  // The cookie name is env-derived; NODE_ENV=test → unprefixed.
  return { id: user.id, cookie: `studio_session=${token}` }
}

async function makeSession(primaryId: string, roomName: string, startsAt: string): Promise<string> {
  const klass = await prisma.class.create({
    data: {
      title: 'C',
      description: 'D',
      discipline: 'yoga',
      defaultDurationMinutes: 60,
      defaultCapacity: 10,
    },
  })
  const room = await prisma.room.create({ data: { name: roomName } })
  const session = await prisma.classSession.create({
    data: {
      classId: klass.id,
      startsAt: new Date(startsAt),
      durationMinutes: 60,
      endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000),
      capacity: 10,
      primaryInstructorId: primaryId,
      roomId: room.id,
    },
  })
  return session.id
}

async function buildWorld(): Promise<World> {
  const staff = await makeUser(UserRole.STAFF)
  const a = await makeUser(UserRole.INSTRUCTOR)
  const b = await makeUser(UserRole.INSTRUCTOR)
  const c = await makeUser(UserRole.INSTRUCTOR)

  const s1 = await makeSession(a.id, `room-s1-${seq}`, '2026-09-07T10:00:00Z')
  const s2 = await makeSession(b.id, `room-s2-${seq}`, '2026-09-07T12:00:00Z')
  // A co-instructs S2.
  await prisma.sessionInstructor.create({ data: { sessionId: s2, instructorId: a.id } })

  const member = await prisma.member.create({
    data: {
      name: 'M',
      email: `m-${seq}@x.test`,
      membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
    },
  })

  return {
    staffCookie: staff.cookie,
    aCookie: a.cookie,
    bCookie: b.cookie,
    cCookie: c.cookie,
    s1,
    s2,
    aId: a.id,
    memberId: member.id,
  }
}

let world: World
beforeEach(async () => {
  await truncateAll(pool)
  world = await buildWorld()
})

// Request helpers. host=localhost so the origin guard is satisfied for
// mutating methods; unauthenticated requests carry no cookie.
function req(method: string, cookie?: string, body?: unknown): Request {
  const headers: Record<string, string> = { host: 'localhost' }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request('http://localhost/api/x', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

// --- capability endpoints: role gate (403), auth gate (401), authorized (501/200) ---

describe('capability-gated endpoints', () => {
  // `staff` is the expectation for an authorized staff caller: 501 for the
  // endpoints still stubbed by later phases, or 'pass' for the Phase-5
  // endpoints that now do real work — where all this table asserts is that
  // authorization did NOT block staff (the exact business status is proven by
  // the domain test suites). Instructor→403 and unauth→401 are the invariants.
  const cases: Array<{
    name: string
    call: (cookie?: string) => Promise<Response>
    staff: number | 'pass'
  }> = [
    { name: 'POST /classes', call: (c) => classCreate(req('POST', c)), staff: 'pass' },
    {
      name: 'PATCH /classes/[id]',
      call: (c) => classPatch(req('PATCH', c), ctx('x')),
      staff: 'pass',
    },
    { name: 'POST /sessions', call: (c) => sessionsCreate(req('POST', c)), staff: 'pass' },
    { name: 'POST /sessions/generate', call: (c) => generate(req('POST', c)), staff: 'pass' },
    { name: 'POST /members', call: (c) => membersCreate(req('POST', c)), staff: 'pass' },
    { name: 'GET /members', call: (c) => membersList(req('GET', c)), staff: 200 },
    {
      name: 'PATCH /members/[id]',
      call: (c) => memberPatch(req('PATCH', c), ctx('x')),
      staff: 'pass',
    },
    { name: 'POST /bookings', call: (c) => bookingCreate(req('POST', c)), staff: 'pass' },
    {
      name: 'POST /bookings/[id]/cancel',
      call: (c) => bookingCancel(req('POST', c), ctx('x')),
      staff: 'pass',
    },
    {
      name: 'POST /bookings/[id]/settle',
      call: (c) => bookingSettle(req('POST', c), ctx('x')),
      staff: 'pass',
    },
    {
      name: 'POST /bookings/[id]/notes',
      call: (c) => bookingNote(req('POST', c), ctx('x')),
      staff: 'pass',
    },
    { name: 'GET /dashboard', call: (c) => dashboard(req('GET', c)), staff: 200 },
    {
      name: 'POST /alert-dismiss',
      call: (c) => alertDismiss(req('POST', c), ctx('x')),
      staff: 'pass',
    },
    {
      name: 'GET /sessions/[id]/attendance',
      call: (c) => attendance(req('GET', c), ctx('x')),
      staff: 'pass',
    },
  ]

  for (const { name, call, staff } of cases) {
    it(`${name}: 401 unauth · 403 instructor · staff authorized`, async () => {
      expect((await call(undefined)).status).toBe(401)

      const denied = await call(world.aCookie)
      expect(denied.status).toBe(403)
      // Must be an AUTHORIZATION denial, not a CSRF/origin 403 masquerading as one.
      expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('forbidden')

      const staffStatus = (await call(world.staffCookie)).status
      if (staff === 'pass') {
        // Authorization did not block staff (the domain suites prove the rest).
        expect([401, 403]).not.toContain(staffStatus)
      } else {
        expect(staffStatus).toBe(staff)
      }
    })
  }
})

// --- id-addressed session mutations are staff-only (not view-scoped) ---------

describe('session mutation is staff-only, even for the assigned instructor', () => {
  const idCases: Array<{
    name: string
    call: (cookie: string | undefined, id: string) => Promise<Response>
  }> = [
    { name: 'PATCH /sessions/[id]', call: (c, id) => sessionPatch(req('PATCH', c), ctx(id)) },
    { name: 'DELETE /sessions/[id]', call: (c, id) => sessionDelete(req('DELETE', c), ctx(id)) },
    {
      name: 'POST /sessions/[id]/co-instructors',
      call: (c, id) => coInstructorAdd(req('POST', c), ctx(id)),
    },
    {
      name: 'DELETE /sessions/[id]/co-instructors',
      call: (c, id) => coInstructorRemove(req('DELETE', c), ctx(id)),
    },
  ]

  for (const { name, call } of idCases) {
    it(`${name}: instructor A (primary of the session) still gets 403`, async () => {
      expect((await call(undefined, world.s1)).status).toBe(401)
      // A is the PRIMARY instructor of S1 — relationship grants no mutation right.
      expect((await call(world.aCookie, world.s1)).status).toBe(403)
      // Staff is authorized (the mutation itself is proven in the domain suite).
      expect([401, 403]).not.toContain((await call(world.staffCookie, world.s1)).status)
    })
  }
})

// --- resource scope: GET /sessions/[id] (404 for out-of-scope) ---------------

describe('session read scope + IDOR', () => {
  it('instructor A sees S1 (primary) and S2 (co)', async () => {
    expect((await sessionGet(req('GET', world.aCookie), ctx(world.s1))).status).toBe(200)
    expect((await sessionGet(req('GET', world.aCookie), ctx(world.s2))).status).toBe(200)
  })

  it('instructor B cannot read S1 — 404, byte-identical to a random uuid', async () => {
    const foreign = await sessionGet(req('GET', world.bCookie), ctx(world.s1))
    const random = await sessionGet(
      req('GET', world.bCookie),
      ctx('00000000-0000-4000-8000-000000000000'),
    )
    expect(foreign.status).toBe(404)
    expect(random.status).toBe(404)
    expect(await foreign.text()).toBe(await random.text())
  })

  it('a malformed uuid is 404, not a 500 leak', async () => {
    const response = await sessionGet(req('GET', world.aCookie), ctx('not-a-uuid'))
    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).not.toMatch(/prisma|P2023|uuid|invalid/i)
  })

  it('staff read of a truly-absent session is 404', async () => {
    expect(
      (await sessionGet(req('GET', world.staffCookie), ctx('00000000-0000-4000-8000-000000000000')))
        .status,
    ).toBe(404)
  })

  it('unauthenticated read is 401, before any resource lookup', async () => {
    expect((await sessionGet(req('GET'), ctx(world.s1))).status).toBe(401)
  })
})

// --- collection scope + count non-leak ---------------------------------------

describe('scoped collection and count', () => {
  async function listOf(cookie: string) {
    const response = await sessionsList(req('GET', cookie))
    expect(response.status).toBe(200)
    return (await response.json()) as { sessions: Array<{ id: string }>; total: number }
  }

  it('staff sees all sessions with a correct total', async () => {
    const { sessions, total } = await listOf(world.staffCookie)
    expect(total).toBe(2)
    expect(new Set(sessions.map((s) => s.id))).toEqual(new Set([world.s1, world.s2]))
  })

  it('instructor A sees exactly {S1, S2}; the total matches the visible rows', async () => {
    const { sessions, total } = await listOf(world.aCookie)
    expect(total).toBe(2)
    expect(new Set(sessions.map((s) => s.id))).toEqual(new Set([world.s1, world.s2]))
  })

  it('instructor B sees only S2 — the count never includes S1', async () => {
    const { sessions, total } = await listOf(world.bCookie)
    expect(total).toBe(1)
    expect(sessions.map((s) => s.id)).toEqual([world.s2])
  })

  it('instructor C (no sessions) gets an empty list and total 0', async () => {
    const { sessions, total } = await listOf(world.cCookie)
    expect(total).toBe(0)
    expect(sessions).toEqual([])
  })

  it('the scoped session read never carries member PII', async () => {
    const response = await sessionGet(req('GET', world.aCookie), ctx(world.s1))
    const text = await response.text()
    expect(text).not.toMatch(/passwordHash|password_hash/)
    expect(text).not.toMatch(/membershipExpiresOn|@x\.test/)
  })
})

// --- relationship revocation (mandated test 9) -------------------------------

describe('access follows the relationship', () => {
  it('removing A as co-instructor of S2 revokes both the read and the list entry', async () => {
    expect((await sessionGet(req('GET', world.aCookie), ctx(world.s2))).status).toBe(200)

    await prisma.sessionInstructor.delete({
      where: { sessionId_instructorId: { sessionId: world.s2, instructorId: world.aId } },
    })

    expect((await sessionGet(req('GET', world.aCookie), ctx(world.s2))).status).toBe(404)
    const list = (await (await sessionsList(req('GET', world.aCookie))).json()) as {
      sessions: Array<{ id: string }>
      total: number
    }
    expect(list.total).toBe(1)
    expect(list.sessions.map((s) => s.id)).toEqual([world.s1])
  })
})

// --- tampering: client-supplied role/id cannot override the server identity --

describe('role and parameter tampering', () => {
  it('an instructor body/query claiming STAFF does not grant capability', async () => {
    // Body fields are irrelevant to the capability guard, and the strict-body
    // stubs parse nothing — role comes only from the session.
    const withBody = await membersList(
      new Request('http://localhost/api/members?role=STAFF&userId=' + world.aId, {
        method: 'GET',
        headers: { host: 'localhost', cookie: world.aCookie, 'x-role': 'STAFF' },
      }),
    )
    expect(withBody.status).toBe(403)
  })

  it('a staff mutation ignores an injected role downgrade and stays authorized', async () => {
    const response = await sessionsCreate(
      req('POST', world.staffCookie, { role: 'INSTRUCTOR', isAdmin: false }),
    )
    // Authorization is decided by the session role, never the body: staff is
    // not blocked (the body then fails domain validation on its own merits).
    expect([401, 403]).not.toContain(response.status)
  })

  it('an instructor body claiming STAFF does not escalate — still 403 (the direction that matters)', async () => {
    const response = await sessionsCreate(
      req('POST', world.aCookie, { role: 'STAFF', isAdmin: true }),
    )
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('scope-widening params (?instructorId=/?userId= of another instructor) are ignored', async () => {
    // Instructor B passes A's ids in the query, trying to widen scope to S1.
    const widenList = new Request(
      `http://localhost/api/sessions?instructorId=${world.aId}&userId=${world.aId}`,
      { method: 'GET', headers: { host: 'localhost', cookie: world.bCookie } },
    )
    const listBody = (await (await sessionsList(widenList)).json()) as {
      sessions: Array<{ id: string }>
      total: number
    }
    // B still sees only S2 — scope derives from the session identity, not the query.
    expect(listBody.total).toBe(1)
    expect(listBody.sessions.map((s) => s.id)).toEqual([world.s2])

    // And the scoped read of S1 with those params still 404s.
    const widenRead = new Request(
      `http://localhost/api/sessions/${world.s1}?instructorId=${world.aId}&userId=${world.aId}`,
      { method: 'GET', headers: { host: 'localhost', cookie: world.bCookie } },
    )
    expect((await sessionGet(widenRead, ctx(world.s1))).status).toBe(404)
  })

  it('duplicate query params and cookies do not confuse scope (parameter pollution)', async () => {
    const polluted = new Request(
      `http://localhost/api/sessions?role=STAFF&role=INSTRUCTOR&instructorId=${world.aId}`,
      {
        method: 'GET',
        headers: { host: 'localhost', cookie: `${world.bCookie}; ${world.aCookie}` },
      },
    )
    const body = (await (await sessionsList(polluted)).json()) as {
      sessions: Array<{ id: string }>
      total: number
    }
    // readSessionToken takes the first cookie (B); scope stays B's.
    expect(body.total).toBe(1)
    expect(body.sessions.map((s) => s.id)).toEqual([world.s2])
  })
})

// --- property-flavored sweep: scope == DB-derived related set ----------------

describe('scope invariant over randomized relationships', () => {
  it('for every instructor, the list is exactly their related sessions and every other id 404s', async () => {
    // Deterministic pseudo-random assignment (no Date/Math.random in workflow,
    // but this is a normal test file — a fixed seed keeps it reproducible).
    const instructors = await Promise.all([
      makeUser(UserRole.INSTRUCTOR),
      makeUser(UserRole.INSTRUCTOR),
      makeUser(UserRole.INSTRUCTOR),
    ])
    const created: Array<{ id: string; related: Set<string> }> = []
    for (let i = 0; i < 9; i++) {
      const primary = instructors[i % 3]!
      const id = await makeSession(
        primary.id,
        `sweep-${seq}-${i}`,
        `2026-10-0${(i % 8) + 1}T09:00:00Z`,
      )
      const related = new Set<string>([primary.id])
      // co-assign one other instructor deterministically
      const co = instructors[(i + 1) % 3]!
      if (co.id !== primary.id) {
        await prisma.sessionInstructor.create({ data: { sessionId: id, instructorId: co.id } })
        related.add(co.id)
      }
      created.push({ id, related })
    }

    for (const inst of instructors) {
      const expected = new Set(created.filter((c) => c.related.has(inst.id)).map((c) => c.id))
      const list = (await (await sessionsList(req('GET', inst.cookie))).json()) as {
        sessions: Array<{ id: string }>
        total: number
      }
      const got = new Set(list.sessions.map((s) => s.id))
      expect(got).toEqual(expected)
      expect(list.total).toBe(expected.size)

      // Every session NOT in the instructor's related set must 404 for them.
      for (const c of created) {
        if (!c.related.has(inst.id)) {
          expect((await sessionGet(req('GET', inst.cookie), ctx(c.id))).status).toBe(404)
        }
      }
    }
  })
})
