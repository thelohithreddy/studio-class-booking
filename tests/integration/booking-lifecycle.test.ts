// tests/integration/booking-lifecycle.test.ts
//
// The booking state machine, capacity, waitlist promotion, cancellation,
// settlement, membership gate, duplicate protection, history consistency and
// authorization — driven against the real route handlers in-process.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as bookingCreate, GET as bookingsList } from '@app/api/bookings/route'
import { GET as bookingGet } from '@app/api/bookings/[id]/route'
import { POST as bookingCancel } from '@app/api/bookings/[id]/cancel/route'
import { POST as bookingSettle } from '@app/api/bookings/[id]/settle/route'

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
let instructorCookie: string
let sessionId: string
let instructorId: string

async function makeUser(role: UserRole): Promise<{ id: string; cookie: string }> {
  seq += 1
  const u = await prisma.user.create({
    data: {
      email: `blc-${role}-${seq}@x.test`,
      name: 'U',
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  return { id: u.id, cookie: `studio_session=${(await createSession(u.id)).token}` }
}

async function makeSession(
  capacity: number,
  startsAt = '2027-01-01T10:00:00Z',
  primaryInstructorId?: string,
): Promise<string> {
  seq += 1
  // Each session gets its own instructor and room by default so parallel
  // fixtures never collide on the room/instructor overlap constraints; the
  // beforeEach session passes the shared instructorId (used by the scope test).
  let instructor = primaryInstructorId
  if (!instructor) {
    instructor = (
      await prisma.user.create({
        data: { email: `blc-si-${seq}@x.test`, name: 'I', role: 'INSTRUCTOR', passwordHash: 'x' },
      })
    ).id
  }
  const c = await prisma.class.create({
    data: {
      title: 'C',
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: capacity,
    },
  })
  const r = await prisma.room.create({ data: { name: `blc-room-${seq}` } })
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt: new Date(startsAt),
      durationMinutes: 60,
      endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000),
      capacity,
      primaryInstructorId: instructor,
      roomId: r.id,
    },
  })
  return s.id
}

async function makeMember(expiresOn = '2027-06-01'): Promise<string> {
  seq += 1
  const m = await prisma.member.create({
    data: {
      name: `M${seq}`,
      email: `blc-m-${seq}@x.test`,
      membershipExpiresOn: new Date(`${expiresOn}T00:00:00Z`),
    },
  })
  return m.id
}

beforeEach(async () => {
  await truncateAll(pool)
  const staff = await makeUser(UserRole.STAFF)
  staffCookie = staff.cookie
  const inst = await makeUser(UserRole.INSTRUCTOR)
  instructorCookie = inst.cookie
  instructorId = inst.id
  sessionId = await makeSession(2, '2027-01-01T10:00:00Z', instructorId)
})

function post(url: string, body: unknown, cookie = staffCookie): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function book(memberId: string, cookie = staffCookie) {
  return bookingCreate(post('/api/bookings', { sessionId, memberId }, cookie))
}
async function bookOk(memberId: string) {
  const res = await book(memberId)
  expect(res.status).toBe(201)
  return (await res.json()) as { booking: { id: string; status: string } }
}

/** Asserts the counter invariant for a session. */
async function assertInvariant(sid: string) {
  const s = await prisma.classSession.findUniqueOrThrow({ where: { id: sid } })
  const audit = await pool.query(
    `SELECT count(*)::int n FROM bookings WHERE session_id=$1 AND status IN ('BOOKED','ATTENDED','NO_SHOW')`,
    [sid],
  )
  expect(s.bookedCount).toBe(audit.rows[0].n)
  expect(s.bookedCount).toBeLessThanOrEqual(s.capacity)
  expect(s.bookedCount).toBeGreaterThanOrEqual(0)
}

// --- create: booked vs waitlisted --------------------------------------------

describe('creation', () => {
  it('books directly when capacity remains, waitlists when full', async () => {
    const a = await bookOk(await makeMember())
    const b = await bookOk(await makeMember())
    const c = await bookOk(await makeMember())
    expect(a.booking.status).toBe('BOOKED')
    expect(b.booking.status).toBe('BOOKED')
    expect(c.booking.status).toBe('WAITLISTED') // capacity 2
    await assertInvariant(sessionId)
  })

  it('capacity 0 waitlists everyone', async () => {
    const zero = await makeSession(0)
    const res = await bookingCreate(
      post('/api/bookings', { sessionId: zero, memberId: await makeMember() }),
    )
    expect(((await res.json()) as { booking: { status: string } }).booking.status).toBe(
      'WAITLISTED',
    )
  })

  it('writes a CREATED event whose to_status is the resolved status', async () => {
    const { booking } = await bookOk(await makeMember())
    const events = await prisma.bookingEvent.findMany({ where: { bookingId: booking.id } })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('CREATED')
    expect(events[0]!.toStatus).toBe('BOOKED')
  })

  it('rejects an instructor creating a booking (403)', async () => {
    expect((await book(await makeMember(), instructorCookie)).status).toBe(403)
  })

  it('rejects a booking for an expired member (422)', async () => {
    const expired = await makeMember('2020-01-01')
    const res = await book(expired)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'membership_expired',
    )
  })

  it('allows a member expiring today (valid through the expiry date)', async () => {
    // studioToday in tests is UTC; set expiry to today's UTC date.
    const today = new Date().toISOString().slice(0, 10)
    const res = await book(await makeMember(today))
    expect(res.status).toBe(201)
  })

  it('rejects a duplicate active booking for the same member+session (409)', async () => {
    const m = await makeMember()
    await bookOk(m)
    const dup = await book(m)
    expect(dup.status).toBe(409)
    expect(await dup.text()).not.toMatch(/prisma|P2002|constraint/i)
  })

  it('allows re-booking after cancellation', async () => {
    const m = await makeMember()
    const { booking } = await bookOk(m)
    await bookingCancel(post(`/api/bookings/${booking.id}/cancel`, {}), ctx(booking.id))
    expect((await book(m)).status).toBe(201)
  })
})

// --- cancel + promotion ------------------------------------------------------

describe('cancellation and waitlist promotion', () => {
  it('cancelling a BOOKED booking promotes the earliest waitlisted member', async () => {
    const m1 = await makeMember()
    const b1 = await bookOk(m1) // BOOKED
    await bookOk(await makeMember()) // BOOKED (capacity 2 full)
    const w1 = await bookOk(await makeMember()) // WAITLISTED (earliest)
    const w2 = await bookOk(await makeMember()) // WAITLISTED (later)
    expect(w1.booking.status).toBe('WAITLISTED')

    const res = await bookingCancel(
      post(`/api/bookings/${b1.booking.id}/cancel`, {}),
      ctx(b1.booking.id),
    )
    expect(res.status).toBe(200)

    // Earliest waitlisted (w1, lower seq) is promoted; w2 stays waitlisted.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: w1.booking.id } })).status).toBe(
      'BOOKED',
    )
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: w2.booking.id } })).status).toBe(
      'WAITLISTED',
    )
    await assertInvariant(sessionId)

    // The promotion wrote its own STATUS_CHANGED event.
    const promoEvents = await prisma.bookingEvent.findMany({
      where: { bookingId: w1.booking.id },
      orderBy: { seq: 'asc' },
    })
    expect(promoEvents.at(-1)!.fromStatus).toBe('WAITLISTED')
    expect(promoEvents.at(-1)!.toStatus).toBe('BOOKED')
  })

  it('cancelling a WAITLISTED booking promotes nobody', async () => {
    await bookOk(await makeMember())
    await bookOk(await makeMember()) // full
    const w1 = await bookOk(await makeMember())
    const w2 = await bookOk(await makeMember())

    await bookingCancel(post(`/api/bookings/${w1.booking.id}/cancel`, {}), ctx(w1.booking.id))
    // w2 is NOT promoted — the session is still full.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: w2.booking.id } })).status).toBe(
      'WAITLISTED',
    )
    await assertInvariant(sessionId)
  })

  it('rejects cancelling an already-cancelled booking (422 invalid transition)', async () => {
    const { booking } = await bookOk(await makeMember())
    await bookingCancel(post(`/api/bookings/${booking.id}/cancel`, {}), ctx(booking.id))
    const again = await bookingCancel(
      post(`/api/bookings/${booking.id}/cancel`, {}),
      ctx(booking.id),
    )
    expect(again.status).toBe(422)
    // No duplicate event.
    expect(await prisma.bookingEvent.count({ where: { bookingId: booking.id } })).toBe(2) // CREATED + one CANCELLED
  })

  it('rejects an instructor cancelling (403)', async () => {
    const { booking } = await bookOk(await makeMember())
    expect(
      (
        await bookingCancel(
          post(`/api/bookings/${booking.id}/cancel`, {}, instructorCookie),
          ctx(booking.id),
        )
      ).status,
    ).toBe(403)
  })
})

// --- settlement --------------------------------------------------------------

describe('attendance settlement', () => {
  it('settles a BOOKED booking to ATTENDED after the session start, unchanged counter', async () => {
    const past = await makeSession(2, '2020-01-01T10:00:00Z')
    const created = await bookingCreate(
      post('/api/bookings', { sessionId: past, memberId: await makeMember() }),
    )
    const { booking } = (await created.json()) as { booking: { id: string } }
    const res = await bookingSettle(
      post(`/api/bookings/${booking.id}/settle`, { status: 'ATTENDED' }),
      ctx(booking.id),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { booking: { status: string } }).booking.status).toBe('ATTENDED')
    await assertInvariant(past) // ATTENDED still counts → booked_count unchanged
  })

  it('settles to NO_SHOW', async () => {
    const past = await makeSession(2, '2020-01-01T10:00:00Z')
    const created = await bookingCreate(
      post('/api/bookings', { sessionId: past, memberId: await makeMember() }),
    )
    const { booking } = (await created.json()) as { booking: { id: string } }
    expect(
      (
        await bookingSettle(
          post(`/api/bookings/${booking.id}/settle`, { status: 'NO_SHOW' }),
          ctx(booking.id),
        )
      ).status,
    ).toBe(200)
  })

  it('rejects settling before the session start time (422 too_early)', async () => {
    const { booking } = await bookOk(await makeMember()) // session starts 2027
    const res = await bookingSettle(
      post(`/api/bookings/${booking.id}/settle`, { status: 'ATTENDED' }),
      ctx(booking.id),
    )
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('too_early')
  })

  it('rejects settling a WAITLISTED booking (422 invalid transition)', async () => {
    const past = await makeSession(1, '2020-01-01T10:00:00Z')
    await bookingCreate(post('/api/bookings', { sessionId: past, memberId: await makeMember() })) // BOOKED
    const created = await bookingCreate(
      post('/api/bookings', { sessionId: past, memberId: await makeMember() }),
    ) // WAITLISTED
    const { booking } = (await created.json()) as { booking: { id: string; status: string } }
    expect(
      (
        await bookingSettle(
          post(`/api/bookings/${booking.id}/settle`, { status: 'ATTENDED' }),
          ctx(booking.id),
        )
      ).status,
    ).toBe(422)
  })

  it('rejects a double settle (422)', async () => {
    const past = await makeSession(2, '2020-01-01T10:00:00Z')
    const created = await bookingCreate(
      post('/api/bookings', { sessionId: past, memberId: await makeMember() }),
    )
    const { booking } = (await created.json()) as { booking: { id: string } }
    await bookingSettle(
      post(`/api/bookings/${booking.id}/settle`, { status: 'ATTENDED' }),
      ctx(booking.id),
    )
    expect(
      (
        await bookingSettle(
          post(`/api/bookings/${booking.id}/settle`, { status: 'NO_SHOW' }),
          ctx(booking.id),
        )
      ).status,
    ).toBe(422)
  })
})

// --- history + reads ---------------------------------------------------------

describe('history and reads', () => {
  it('current status always matches the latest event, and the timeline is append-only', async () => {
    const { booking } = await bookOk(await makeMember())
    await bookingCancel(
      post(`/api/bookings/${booking.id}/cancel`, { note: 'member called' }),
      ctx(booking.id),
    )
    const res = await bookingGet(
      new Request(`http://localhost/api/bookings/${booking.id}`, {
        headers: { host: 'localhost', cookie: staffCookie },
      }),
      ctx(booking.id),
    )
    const body = (await res.json()) as {
      booking: { status: string; events: Array<{ toStatus: string | null; note: string | null }> }
    }
    expect(body.booking.status).toBe('CANCELLED')
    expect(body.booking.events.at(-1)!.toStatus).toBe('CANCELLED')
    expect(body.booking.events.at(-1)!.note).toBe('member called')
    // Immutable: no API path updates or deletes an event.
  })

  it('scopes reads: an instructor sees bookings for their sessions but 404s others', async () => {
    const { booking } = await bookOk(await makeMember())
    // instructorId teaches sessionId, so the instructor CAN read it.
    const own = await bookingGet(
      new Request(`http://localhost/api/bookings/${booking.id}`, {
        headers: { host: 'localhost', cookie: instructorCookie },
      }),
      ctx(booking.id),
    )
    expect(own.status).toBe(200)

    // A different instructor (teaches nothing) cannot.
    const other = await makeUser(UserRole.INSTRUCTOR)
    const foreign = await bookingGet(
      new Request(`http://localhost/api/bookings/${booking.id}`, {
        headers: { host: 'localhost', cookie: other.cookie },
      }),
      ctx(booking.id),
    )
    expect(foreign.status).toBe(404)
  })

  it('list is scoped and paginated with a total', async () => {
    await bookOk(await makeMember())
    await bookOk(await makeMember())
    const res = await bookingsList(
      new Request('http://localhost/api/bookings', {
        headers: { host: 'localhost', cookie: staffCookie },
      }),
    )
    const body = (await res.json()) as { bookings: unknown[]; total: number; page: number }
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
  })
})

// --- mass assignment / actor spoofing ----------------------------------------

describe('mass assignment and actor integrity', () => {
  it('ignores client-supplied status, actorId, bookedCount on create (400 on unknown keys)', async () => {
    const m = await makeMember()
    const res = await bookingCreate(
      post('/api/bookings', {
        sessionId,
        memberId: m,
        status: 'ATTENDED',
        actorUserId: m,
        bookedCount: 99,
      }),
    )
    expect(res.status).toBe(400)
  })

  it('records the authenticated staff as the event actor, never a body value', async () => {
    const { booking } = await bookOk(await makeMember())
    const event = await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: booking.id } })
    const staff = await prisma.user.findFirstOrThrow({ where: { role: 'STAFF' } })
    expect(event.actorUserId).toBe(staff.id)
  })
})
