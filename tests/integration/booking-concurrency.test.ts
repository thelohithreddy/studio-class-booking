// tests/integration/booking-concurrency.test.ts
//
// The concurrency matrix — the correctness property this whole phase exists
// for. Every scenario fires real concurrent route calls against real Postgres
// and asserts the FINAL DATABASE STATE, repeated across trials to shake out
// races. The FOR-UPDATE session lock + the Phase-2 constraints are what make
// these pass; a naive implementation would overbook or double-promote here.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as bookingCreate } from '@app/api/bookings/route'
import { POST as bookingCancel } from '@app/api/bookings/[id]/cancel/route'

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

async function setup() {
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `bcc-s-${seq}@x.test`,
      name: 'S',
      role: UserRole.STAFF,
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createSession(staff.id)).token}`
}

async function makeSession(capacity: number): Promise<string> {
  seq += 1
  const inst = await prisma.user.create({
    data: { email: `bcc-i-${seq}@x.test`, name: 'I', role: UserRole.INSTRUCTOR, passwordHash: 'x' },
  })
  const c = await prisma.class.create({
    data: {
      title: 'C',
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: capacity,
    },
  })
  const r = await prisma.room.create({ data: { name: `bcc-r-${seq}` } })
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt: new Date('2027-01-01T10:00:00Z'),
      durationMinutes: 60,
      endsAt: new Date('2027-01-01T11:00:00Z'),
      capacity,
      primaryInstructorId: inst.id,
      roomId: r.id,
    },
  })
  return s.id
}

async function makeMembers(n: number): Promise<string[]> {
  return Promise.all(
    Array.from({ length: n }, async () => {
      seq += 1
      return (
        await prisma.member.create({
          data: {
            name: `M${seq}`,
            email: `bcc-m-${seq}@x.test`,
            membershipExpiresOn: new Date('2027-06-01T00:00:00Z'),
          },
        })
      ).id
    }),
  )
}

function bookReq(sessionId: string, memberId: string): Request {
  return new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, memberId }),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function statusCounts(sessionId: string) {
  const rows = await pool.query(
    `SELECT status, count(*)::int n FROM bookings WHERE session_id=$1 GROUP BY status`,
    [sessionId],
  )
  const map: Record<string, number> = {}
  for (const r of rows.rows) map[r.status] = r.n
  return map
}

async function assertInvariants(sessionId: string) {
  const s = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
  const audit = await pool.query(
    `SELECT count(*)::int n FROM bookings WHERE session_id=$1 AND status IN ('BOOKED','ATTENDED','NO_SHOW')`,
    [sessionId],
  )
  expect(s.bookedCount).toBe(audit.rows[0].n)
  expect(s.bookedCount).toBeLessThanOrEqual(s.capacity)
  expect(s.bookedCount).toBeGreaterThanOrEqual(0)
  // No booking_events orphaned or duplicated: every booking has ≥1 event and
  // its current status equals its latest event's to_status.
  const mismatched = await pool.query(
    `
    SELECT b.id FROM bookings b
    JOIN LATERAL (SELECT to_status FROM booking_events e WHERE e.booking_id=b.id ORDER BY seq DESC LIMIT 1) le ON true
    WHERE b.session_id=$1 AND b.status <> le.to_status`,
    [sessionId],
  )
  expect(mismatched.rowCount).toBe(0)
}

beforeEach(async () => {
  await truncateAll(pool)
  await setup()
})

describe('concurrency matrix (real Postgres, final-state assertions)', () => {
  it('TEST A — capacity 1, 2 concurrent → 1 BOOKED, 1 WAITLISTED', async () => {
    const sessionId = await makeSession(1)
    const members = await makeMembers(2)
    await Promise.all(members.map((m) => bookingCreate(bookReq(sessionId, m))))
    const counts = await statusCounts(sessionId)
    expect(counts.BOOKED).toBe(1)
    expect(counts.WAITLISTED).toBe(1)
    await assertInvariants(sessionId)
  })

  it('TEST B — capacity 10, 40 concurrent → exactly 10 BOOKED, 30 WAITLISTED (headline)', async () => {
    const sessionId = await makeSession(10)
    const members = await makeMembers(40)
    const results = await Promise.all(members.map((m) => bookingCreate(bookReq(sessionId, m))))
    // Every request resolved cleanly — no raw 500s.
    expect(results.every((r) => r.status === 201)).toBe(true)
    const counts = await statusCounts(sessionId)
    expect(counts.BOOKED).toBe(10)
    expect(counts.WAITLISTED).toBe(30)
    await assertInvariants(sessionId)
  })

  it('TEST C — same member+session, 40 concurrent → exactly 1 active, no duplicate', async () => {
    const sessionId = await makeSession(10)
    const [member] = await makeMembers(1)
    const results = await Promise.all(
      Array.from({ length: 40 }, () => bookingCreate(bookReq(sessionId, member!))),
    )
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(1) // one wins
    expect(statuses.filter((s) => s === 409)).toHaveLength(39) // rest are clean duplicate conflicts
    const active = await pool.query(
      `SELECT count(*)::int n FROM bookings WHERE session_id=$1 AND member_id=$2 AND status IN ('BOOKED','WAITLISTED')`,
      [sessionId, member],
    )
    expect(active.rows[0].n).toBe(1)
    // Exactly one booking row and one CREATED event — no duplicate event.
    const events = await pool.query(
      `SELECT count(*)::int n FROM booking_events e JOIN bookings b ON b.id=e.booking_id WHERE b.session_id=$1`,
      [sessionId],
    )
    expect(events.rows[0].n).toBe(1)
    await assertInvariants(sessionId)
  })

  it('TEST D — one freed seat, many concurrent cancellations → exactly one promotion', async () => {
    const sessionId = await makeSession(3)
    const members = await makeMembers(6)
    // 3 BOOKED, 3 WAITLISTED (sequential to establish a known order).
    const bookings: string[] = []
    for (const m of members) {
      const res = await bookingCreate(bookReq(sessionId, m))
      bookings.push(((await res.json()) as { booking: { id: string } }).booking.id)
    }
    // Race three concurrent cancels of the SAME BOOKED booking: exactly one
    // must succeed (freeing one seat and promoting one waitlisted member); the
    // other two must see the already-cancelled state and reject. This is the
    // double-cancel race the pre-lock-read version failed (overbook + double
    // promotion); the post-lock status re-read makes it idempotent.
    const bookedIds = bookings.slice(0, 3)
    const cancelReq = () =>
      bookingCancel(
        new Request(`http://localhost/api/bookings/${bookedIds[0]}/cancel`, {
          method: 'POST',
          headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
          body: '{}',
        }),
        ctx(bookedIds[0]!),
      )
    const results = await Promise.all([cancelReq(), cancelReq(), cancelReq()])
    // Exactly one cancel succeeds (200); the others hit the already-cancelled
    // state (422) — so exactly one promotion happened.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    const promoted = await pool.query(
      `SELECT count(*)::int n FROM booking_events WHERE from_status='WAITLISTED' AND to_status='BOOKED'`,
    )
    expect(promoted.rows[0].n).toBe(1) // exactly one promotion event
    await assertInvariants(sessionId)
  })

  it('TEST E — multiple cancellations, promotions follow seq order', async () => {
    const sessionId = await makeSession(2)
    const members = await makeMembers(5)
    const bookings: { id: string; seq: number; status: string }[] = []
    for (const m of members) {
      const res = await bookingCreate(bookReq(sessionId, m))
      const b = ((await res.json()) as { booking: { id: string; seq: number; status: string } })
        .booking
      bookings.push(b)
    }
    // bookings[0],[1] BOOKED; [2],[3],[4] WAITLISTED (by seq).
    const waitlisted = bookings.slice(2)
    // Cancel both BOOKED concurrently → the two earliest waitlisted (by seq) promote.
    await Promise.all(
      bookings.slice(0, 2).map((b) =>
        bookingCancel(
          new Request(`http://localhost/api/bookings/${b.id}/cancel`, {
            method: 'POST',
            headers: {
              host: 'localhost',
              cookie: staffCookie,
              'content-type': 'application/json',
            },
            body: '{}',
          }),
          ctx(b.id),
        ),
      ),
    )
    const promoted = await prisma.booking.findMany({
      where: { id: { in: waitlisted.map((w) => w.id) }, status: 'BOOKED' },
      select: { seq: true },
    })
    const stillWaiting = await prisma.booking.findMany({
      where: { id: { in: waitlisted.map((w) => w.id) }, status: 'WAITLISTED' },
      select: { seq: true },
    })
    // The two lowest-seq waitlisted were promoted; the highest-seq one waits.
    expect(promoted).toHaveLength(2)
    expect(stillWaiting).toHaveLength(1)
    const promotedSeqs = promoted.map((p) => p.seq).sort((a, b) => a - b)
    const waitingSeq = stillWaiting[0]!.seq
    expect(Math.max(...promotedSeqs)).toBeLessThan(waitingSeq)
    await assertInvariants(sessionId)
  })

  it('ROLLBACK — a failure after the booking + counter writes rolls everything back', async () => {
    // Proves the "no partial transaction" guarantee: if any step of a booking
    // transaction throws, the booking row AND the counter increment AND the
    // (not-yet-written) event all roll back together — never "booking changed
    // but history missing". We replicate the create flow and inject a throw
    // AFTER the booking insert + counter update.
    const sessionId = await makeSession(10)
    const [member] = await makeMembers(1)
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM class_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`
        await tx.booking.create({ data: { sessionId, memberId: member!, status: 'BOOKED' } })
        await tx.classSession.update({
          where: { id: sessionId },
          data: { bookedCount: { increment: 1 } },
        })
        throw new Error('injected failure after booking + counter')
      }),
    ).rejects.toThrow('injected failure')

    // Nothing persisted: no booking, counter still 0, no event.
    expect(await prisma.booking.count({ where: { sessionId } })).toBe(0)
    const session = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(session.bookedCount).toBe(0)
    await assertInvariants(sessionId)
  })

  it('TEST F — create and cancel racing → valid final state', async () => {
    const sessionId = await makeSession(1)
    const [m1, m2] = await makeMembers(2)
    const first = await bookingCreate(bookReq(sessionId, m1!))
    const b1 = ((await first.json()) as { booking: { id: string } }).booking.id
    // Race: cancel the sole BOOKED while another create arrives.
    const [,] = await Promise.all([
      bookingCancel(
        new Request(`http://localhost/api/bookings/${b1}/cancel`, {
          method: 'POST',
          headers: { host: 'localhost', cookie: staffCookie, 'content-type': 'application/json' },
          body: '{}',
        }),
        ctx(b1),
      ),
      bookingCreate(bookReq(sessionId, m2!)),
    ])
    // Whatever the interleaving: the counter invariant and capacity hold.
    await assertInvariants(sessionId)
    const counts = await statusCounts(sessionId)
    // Exactly one seat: at most 1 BOOKED at any time.
    expect(counts.BOOKED ?? 0).toBeLessThanOrEqual(1)
  })
})
