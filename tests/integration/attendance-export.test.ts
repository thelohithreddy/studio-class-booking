// tests/integration/attendance-export.test.ts
//
// The secure CSV attendance export (Goal 7) end to end: real route handler,
// real Postgres, and the CSV parsed back with a real parser (csv-parse) so a
// column shift or quoting bug cannot hide. Covers the authorization boundary,
// data minimization, CSV correctness (escaping, Unicode, formula injection),
// filename safety, empty export, no-duplicate-rows, and a constant-query (no
// N+1) check.
import { parse } from 'csv-parse/sync'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as attendanceExport } from '@app/api/sessions/[id]/attendance/route'

import { PrismaClient } from '@/generated/prisma/client'
import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { exportSessionAttendanceCsv } from '@/server/domain/attendance'
import type { BookingStatus } from '@/generated/prisma/enums'

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
      data: { email: `ae-i-${seq}@x.test`, name: `I${seq}`, role: 'INSTRUCTOR', passwordHash: 'x' },
    })
  ).id
}

async function makeSession(primaryId?: string): Promise<string> {
  seq += 1
  const primary = primaryId ?? (await newInstructor())
  const c = await prisma.class.create({
    data: {
      title: `C${seq}`,
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: 50,
    },
  })
  const room = await prisma.room.create({ data: { name: `ae-r-${seq}` } })
  const startsAt = new Date('2027-01-05T18:00:00Z')
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt,
      durationMinutes: 60,
      endsAt: new Date('2027-01-05T19:00:00Z'),
      capacity: 50,
      primaryInstructorId: primary,
      roomId: room.id,
    },
  })
  return s.id
}

async function addBooking(sessionId: string, name: string, email: string, status: BookingStatus) {
  seq += 1
  const member = await prisma.member.create({
    data: { name, email, membershipExpiresOn: new Date('2027-12-01T00:00:00Z') },
  })
  await prisma.booking.create({ data: { sessionId, memberId: member.id, status } })
}

function req(id: string, cookie?: string): Request {
  return new Request(`http://localhost/api/sessions/${id}/attendance`, {
    method: 'GET',
    headers: { host: 'localhost', ...(cookie ? { cookie } : {}) },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

/** Fetch the export and return raw bytes + decoded text + parsed rows. We read
 * the arrayBuffer (not res.text(), which decodes with ignoreBOM:false and would
 * silently strip the BOM) so the BOM bytes can be asserted; TextDecoder then
 * strips the BOM for the text/rows. */
async function exportRows(id: string, cookie = staffCookie) {
  const res = await attendanceExport(req(id, cookie), ctx(id))
  if (res.status !== 200) return { res, bytes: new Uint8Array(), text: '', rows: [] as string[][] }
  const bytes = new Uint8Array(await res.arrayBuffer())
  const text = new TextDecoder('utf-8').decode(bytes) // strips a leading BOM
  const rows = parse(text) as string[][]
  return { res, bytes, text, rows }
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `ae-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
})

describe('attendance CSV export — happy path & headers', () => {
  it('staff export: 200, correct headers, BOM, and one row per booking in seq order', async () => {
    const sid = await makeSession()
    await addBooking(sid, 'Ada Lovelace', 'ada@x.test', 'ATTENDED')
    await addBooking(sid, 'Grace Hopper', 'grace@x.test', 'NO_SHOW')
    await addBooking(sid, 'Edsger', 'ed@x.test', 'WAITLISTED')

    const { res, bytes, rows } = await exportRows(sid)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="attendance-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.csv"$/,
    )
    // UTF-8 BOM (EF BB BF) so Excel decodes Unicode names correctly.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])

    expect(rows[0]).toEqual(['Member Name', 'Member Email', 'Status'])
    expect(rows.slice(1)).toEqual([
      ['Ada Lovelace', 'ada@x.test', 'ATTENDED'],
      ['Grace Hopper', 'grace@x.test', 'NO_SHOW'],
      ['Edsger', 'ed@x.test', 'WAITLISTED'],
    ])
  })

  it('includes bookings of EVERY status (the complete attendance picture)', async () => {
    const sid = await makeSession()
    const statuses: BookingStatus[] = ['BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW']
    for (const [i, st] of statuses.entries()) {
      await addBooking(sid, `M${i}`, `m${i}@x.test`, st)
    }
    const { rows } = await exportRows(sid)
    expect(rows.slice(1).map((r) => r[2])).toEqual(statuses) // seq order preserved
  })

  it('an empty session exports a valid header-only CSV (200, not an error)', async () => {
    const sid = await makeSession()
    const { res, rows } = await exportRows(sid)
    expect(res.status).toBe(200)
    expect(rows).toEqual([['Member Name', 'Member Email', 'Status']])
  })
})

describe('attendance CSV export — authorization boundary', () => {
  it('an instructor (even the session primary) gets 403 — export is staff-only', async () => {
    const inst = await newInstructor()
    const sid = await makeSession(inst)
    await addBooking(sid, 'Ada', 'ada@x.test', 'ATTENDED')
    const cookie = `studio_session=${(await createAuthSession(inst)).token}`
    const res = await attendanceExport(req(sid, cookie), ctx(sid))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('unauthenticated → 401', async () => {
    const sid = await makeSession()
    expect((await attendanceExport(req(sid), ctx(sid))).status).toBe(401)
  })

  it('a missing session → 404; a malformed/SQLi id → 404, and the table is intact', async () => {
    // Seed a known row so the "table intact" check is a real regression assertion.
    const sid = await makeSession()
    await addBooking(sid, 'Ada', 'ada@x.test', 'BOOKED')
    expect(await prisma.booking.count()).toBe(1)

    const ghost = '00000000-0000-4000-8000-000000000000'
    expect((await attendanceExport(req(ghost, staffCookie), ctx(ghost))).status).toBe(404)

    const bad = "not-a-uuid'; DROP TABLE bookings;--"
    expect((await attendanceExport(req(bad, staffCookie), ctx(bad))).status).toBe(404)

    // The SQLi payload changed nothing — the seeded booking (and its table) survive.
    expect(await prisma.booking.count()).toBe(1)
  })
})

describe('attendance CSV export — CSV correctness (round-trip via a real parser)', () => {
  it('escapes comma, quote and newline, and preserves Unicode', async () => {
    const sid = await makeSession()
    const cells: Array<[string, string]> = [
      ['Smith, John', 'comma@x.test'],
      ['John "JD" Smith', 'quote@x.test'],
      ['line1\nline2', 'newline@x.test'],
      ['లోహిత్ రెడ్డి 🔥', 'unicode@x.test'], // Telugu + emoji
    ]
    for (const [name, email] of cells) await addBooking(sid, name, email, 'ATTENDED')
    const { rows } = await exportRows(sid)
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual(cells)
  })

  it('neutralizes spreadsheet formula injection from a member name', async () => {
    const sid = await makeSession()
    await addBooking(sid, '=HYPERLINK("http://evil","pwned")', 'evil@x.test', 'BOOKED')
    const { text, rows } = await exportRows(sid)
    // The dangerous cell is prefixed with an apostrophe in the raw bytes...
    expect(text).toContain("'=HYPERLINK")
    // ...and a parser reconstructs it as inert text, not a formula.
    expect(rows[1]![0]).toBe('\'=HYPERLINK("http://evil","pwned")')
  })

  it('the download filename is built only from safe server-derived bytes', async () => {
    // Even with a hostile class/member context, the filename is date + uuid.
    const sid = await makeSession()
    await addBooking(sid, '=cmd\r\nInjected: header', 'x@x.test', 'BOOKED')
    const res = await attendanceExport(req(sid, staffCookie), ctx(sid))
    const cd = res.headers.get('content-disposition')!
    expect(cd).toMatch(/^attachment; filename="attendance-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.csv"$/)
    expect(cd).not.toContain('\n')
    expect(cd).not.toContain('\r')
  })
})

describe('attendance CSV export — data model & minimization', () => {
  it('a session with co-instructors still yields exactly one row per booking (no fan-out)', async () => {
    const sid = await makeSession()
    // Two co-instructors on the session must not multiply the booking rows.
    for (let i = 0; i < 2; i += 1) {
      const co = await newInstructor()
      await prisma.sessionInstructor.create({ data: { sessionId: sid, instructorId: co } })
    }
    await addBooking(sid, 'Ada', 'ada@x.test', 'BOOKED')
    await addBooking(sid, 'Grace', 'grace@x.test', 'ATTENDED')
    const { rows } = await exportRows(sid)
    expect(rows).toHaveLength(3) // header + exactly 2 bookings
  })

  it('exports exactly three columns and no credential/secret fields', async () => {
    const sid = await makeSession()
    await addBooking(sid, 'Ada', 'ada@x.test', 'ATTENDED')
    const { text, rows } = await exportRows(sid)
    expect(rows.every((r) => r.length === 3)).toBe(true)
    // Members have no password/token columns at all; assert none leaked in anyway.
    expect(text.toLowerCase()).not.toContain('passwordhash')
    expect(text.toLowerCase()).not.toContain('password')
    expect(text).not.toContain('studio_session')
  })

  it('does NOT export another session’s bookings (dataset scoped to the one session)', async () => {
    const a = await makeSession()
    const b = await makeSession()
    await addBooking(a, 'Ada', 'ada@x.test', 'BOOKED')
    await addBooking(b, 'Grace', 'grace@x.test', 'BOOKED')
    const { rows } = await exportRows(a)
    expect(rows.slice(1)).toEqual([['Ada', 'ada@x.test', 'BOOKED']]) // only session a
  })
})

describe('attendance CSV export — defensive size cap', () => {
  it('refuses with 413 when the booking count exceeds the row cap, allows at the boundary', async () => {
    const sid = await makeSession()
    for (let i = 0; i < 3; i += 1) await addBooking(sid, `M${i}`, `m${i}@x.test`, 'BOOKED')
    // A low cap (2) with 3 bookings overflows → a clean 413, not an unbounded string.
    await expect(exportSessionAttendanceCsv(prisma, sid, 2)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    })
    // Exactly at the cap (3 rows, cap 3) is allowed.
    const ok = await exportSessionAttendanceCsv(prisma, sid, 3)
    expect(ok.body).toContain('M0')
  })
})

describe('attendance CSV export — no N+1 (constant query count)', () => {
  it('issues the same number of queries for 2 bookings and 12 bookings', async () => {
    const makeLogged = () => {
      const client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testUrl }),
        log: [{ level: 'query', emit: 'event' }],
      })
      let count = 0
      client.$on('query', () => {
        count += 1
      })
      return { client, count: () => count }
    }

    const small = await makeSession()
    for (let i = 0; i < 2; i += 1) await addBooking(small, `S${i}`, `s${i}@x.test`, 'BOOKED')
    const big = await makeSession()
    for (let i = 0; i < 12; i += 1) await addBooking(big, `B${i}`, `b${i}@x.test`, 'BOOKED')

    const a = makeLogged()
    await exportSessionAttendanceCsv(a.client as never, small)
    await a.client.$disconnect()

    const b = makeLogged()
    await exportSessionAttendanceCsv(b.client as never, big)
    await b.client.$disconnect()

    expect(a.count()).toBeGreaterThan(0) // the query log actually fired
    expect(b.count()).toBe(a.count()) // constant regardless of row count → no N+1
  })
})
