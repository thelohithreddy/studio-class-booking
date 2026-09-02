// tests/integration/attendance-authorization.test.ts
//
// Phase 16 — instructor attendance authorization (Goal 1: instructors "record
// who actually showed up"). Settlement is granted to STAFF and INSTRUCTOR at
// the role gate, then narrowed by an object-level scope check: an instructor may
// settle ONLY a booking on a session they teach (primary or co). Every other
// booking verb (cancel/notes) stays staff-only. Drives the real route handlers.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as bookingCreate } from '@app/api/bookings/route'
import { POST as bookingSettle } from '@app/api/bookings/[id]/settle/route'
import { POST as bookingCancel } from '@app/api/bookings/[id]/cancel/route'
import { POST as bookingNote } from '@app/api/bookings/[id]/notes/route'

import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
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
async function makeUser(role: UserRole): Promise<{ id: string; cookie: string }> {
  seq += 1
  const u = await prisma.user.create({
    data: {
      email: `aa-${role}-${seq}@x.test`,
      name: role === 'STAFF' ? 'Staff' : `Instr${seq}`,
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  return { id: u.id, cookie: `studio_session=${(await createAuthSession(u.id)).token}` }
}

/** A session that has already started (2020) so settlement is not too_early. */
async function makeStartedSession(primaryInstructorId: string): Promise<string> {
  seq += 1
  const c = await prisma.class.create({
    data: {
      title: 'C',
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: 5,
    },
  })
  const r = await prisma.room.create({ data: { name: `aa-room-${seq}` } })
  const startsAt = new Date(`2020-01-0${(seq % 8) + 1}T10:00:00Z`)
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt,
      durationMinutes: 60,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: 5,
      primaryInstructorId,
      roomId: r.id,
    },
  })
  return s.id
}

async function makeMember(): Promise<string> {
  seq += 1
  const m = await prisma.member.create({
    data: {
      name: `M${seq}`,
      email: `aa-m-${seq}@x.test`,
      membershipExpiresOn: new Date('2027-06-01T00:00:00Z'),
    },
  })
  return m.id
}

function post(url: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

let staff: { id: string; cookie: string }
let owner: { id: string; cookie: string } // primary instructor of the session under test
let other: { id: string; cookie: string } // unrelated instructor
let sessionId: string

/** Book a member into the session AS STAFF (only staff may create bookings). */
async function bookMember(sid = sessionId): Promise<string> {
  const memberId = await makeMember()
  const res = await bookingCreate(post('/api/bookings', { sessionId: sid, memberId }, staff.cookie))
  expect(res.status).toBe(201)
  return ((await res.json()) as { booking: { id: string } }).booking.id
}

beforeEach(async () => {
  await truncateAll(pool)
  staff = await makeUser(UserRole.STAFF)
  owner = await makeUser(UserRole.INSTRUCTOR)
  other = await makeUser(UserRole.INSTRUCTOR)
  sessionId = await makeStartedSession(owner.id)
})

async function settle(
  bookingId: string,
  cookie?: string,
  status: 'ATTENDED' | 'NO_SHOW' = 'ATTENDED',
) {
  return bookingSettle(
    post(`/api/bookings/${bookingId}/settle`, { status }, cookie),
    ctx(bookingId),
  )
}

describe('attendance settlement authorization (Goal 1)', () => {
  it('STAFF may settle any booking', async () => {
    const res = await settle(await bookMember(), staff.cookie)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { booking: { status: string } }).booking.status).toBe('ATTENDED')
  })

  it('the PRIMARY instructor may settle a booking on their own session', async () => {
    const res = await settle(await bookMember(), owner.cookie)
    expect(res.status).toBe(200)
  })

  it('a CO-instructor may settle a booking on a session they co-teach', async () => {
    await prisma.sessionInstructor.create({ data: { sessionId, instructorId: other.id } })
    const res = await settle(await bookMember(), other.cookie)
    expect(res.status).toBe(200)
  })

  it('an UNRELATED instructor is denied — 404, no existence leak', async () => {
    const bookingId = await bookMember()
    const res = await settle(bookingId, other.cookie)
    expect(res.status).toBe(404) // indistinguishable from a missing booking
    // And the booking was NOT modified.
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })
    expect(row.status).toBe('BOOKED')
  })

  it('an unauthenticated request is denied — 401', async () => {
    const res = await settle(await bookMember(), undefined)
    expect(res.status).toBe(401)
  })

  it('IDOR: settling a well-formed but nonexistent booking id → 404', async () => {
    const res = await settle('00000000-0000-4000-8000-000000000000', owner.cookie)
    expect(res.status).toBe(404)
  })

  it('the booking state machine still applies to instructors (WAITLISTED → 422)', async () => {
    // Fill a capacity-1 started session, then a second booking waitlists.
    seq += 1
    const c = await prisma.class.create({
      data: {
        title: 'F',
        description: 'd',
        discipline: 'y',
        defaultDurationMinutes: 60,
        defaultCapacity: 1,
      },
    })
    const r = await prisma.room.create({ data: { name: `aa-full-${seq}` } })
    const startsAt = new Date('2020-02-01T10:00:00Z')
    const full = await prisma.classSession.create({
      data: {
        classId: c.id,
        startsAt,
        durationMinutes: 60,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        capacity: 1,
        primaryInstructorId: owner.id,
        roomId: r.id,
      },
    })
    await bookMember(full.id) // BOOKED
    const waitlistedId = await bookMember(full.id) // WAITLISTED
    const res = await settle(waitlistedId, owner.cookie)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_transition',
    )
  })

  it('instructors CANNOT cancel a booking (staff-only) — 403 even on their own session', async () => {
    const bookingId = await bookMember()
    const res = await bookingCancel(
      post(`/api/bookings/${bookingId}/cancel`, {}, owner.cookie),
      ctx(bookingId),
    )
    expect(res.status).toBe(403)
  })

  it('instructors CANNOT add a note (staff-only) — 403', async () => {
    const bookingId = await bookMember()
    const res = await bookingNote(
      post(`/api/bookings/${bookingId}/notes`, { note: 'hi' }, owner.cookie),
      ctx(bookingId),
    )
    expect(res.status).toBe(403)
  })
})
