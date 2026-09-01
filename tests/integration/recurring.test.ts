// tests/integration/recurring.test.ts
//
// Recurring generation (Goal 7): a weekly pattern across a date range yields a
// PARTIAL report — sessions created plus occurrences skipped because the
// instructor or room was already booked. Real route, real Postgres. DST-correct
// occurrence timing is proved separately (tests/unit/studio-time.test.ts); the
// integration env is UTC, so occurrence instants here are the wall-clock time in
// UTC.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as sessionGenerate } from '@app/api/sessions/generate/route'

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
      data: { email: `rc-i-${seq}@x.test`, name: `I${seq}`, role: 'INSTRUCTOR', passwordHash: 'x' },
    })
  ).id
}

async function scaffold() {
  seq += 1
  const c = await prisma.class.create({
    data: {
      title: `RC${seq}`,
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: 12,
    },
  })
  const room = await prisma.room.create({ data: { name: `rr-${seq}` } })
  const instructorId = await newInstructor()
  return { classId: c.id, roomId: room.id, instructorId }
}

type Report = {
  created: { id: string; startsAt: string }[]
  skipped: { date: string; reason: 'instructor' | 'room' }[]
  summary: { requested: number; created: number; skipped: number }
}

function genReq(body: unknown, cookie = staffCookie): Request {
  return new Request('http://localhost/api/sessions/generate', {
    method: 'POST',
    headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function generate(body: unknown, cookie = staffCookie) {
  const res = await sessionGenerate(genReq(body, cookie))
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as Report) : null }
}

// A Tuesday and the four Tuesdays 2027-01-05 … 2027-01-26.
const TUESDAY = new Date('2027-01-05T00:00:00Z').getUTCDay()
const FOUR_TUESDAYS = ['2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26']

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `rc-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
})

describe('recurring generation — happy path', () => {
  it('one weekday across four weeks → four sessions at the pattern time', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const { status, body } = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-26',
      weekdays: [TUESDAY],
      startTime: '18:00',
    })
    expect(status).toBe(200)
    expect(body!.summary).toEqual({ requested: 4, created: 4, skipped: 0 })
    // Boundaries inclusive: first and last Tuesday both present, at 18:00Z.
    expect(body!.created.map((c) => c.startsAt).sort()).toEqual(
      FOUR_TUESDAYS.map((d) => `${d}T18:00:00.000Z`),
    )
  })

  it('multiple weekdays in one request', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const wednesday = (TUESDAY + 1) % 7
    const { body } = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05', // Tue
      endDate: '2027-01-13', // covers Tue 05, Wed 06, Tue 12, Wed 13
      weekdays: [TUESDAY, wednesday],
      startTime: '09:30',
    })
    expect(body!.summary.created).toBe(4)
  })

  it('inherits class default duration/capacity, and honours overrides', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const inherit = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-05',
      weekdays: [TUESDAY],
      startTime: '18:00',
    })
    const s1 = await prisma.classSession.findUniqueOrThrow({
      where: { id: inherit.body!.created[0]!.id },
    })
    expect(s1.durationMinutes).toBe(60)
    expect(s1.capacity).toBe(12)

    await truncateAll(pool)
    const staff = await prisma.user.create({
      data: { email: `rc-s2-${seq}@x.test`, name: 'S', role: 'STAFF', passwordHash: 'x' },
    })
    staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
    const s = await scaffold()
    const override = await generate({
      classId: s.classId,
      primaryInstructorId: s.instructorId,
      roomId: s.roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-05',
      weekdays: [TUESDAY],
      startTime: '18:00',
      durationMinutes: 45,
      capacity: 5,
    })
    const s2 = await prisma.classSession.findUniqueOrThrow({
      where: { id: override.body!.created[0]!.id },
    })
    expect(s2.durationMinutes).toBe(45)
    expect(s2.capacity).toBe(5)
    expect(s2.endsAt.toISOString()).toBe('2027-01-05T18:45:00.000Z')
  })
})

describe('recurring generation — partial skips (Goal 7 report)', () => {
  it('skips an occurrence when the ROOM is already booked, creates the rest', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    // Pre-book the room at the 2nd Tuesday, 18:00, with a DIFFERENT instructor.
    const other = await newInstructor()
    await prisma.classSession.create({
      data: {
        classId,
        startsAt: new Date('2027-01-12T18:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2027-01-12T19:00:00Z'),
        capacity: 5,
        primaryInstructorId: other,
        roomId,
      },
    })
    const { body } = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-26',
      weekdays: [TUESDAY],
      startTime: '18:00',
    })
    expect(body!.summary).toEqual({ requested: 4, created: 3, skipped: 1 })
    expect(body!.skipped).toEqual([{ date: '2027-01-12', reason: 'room' }])
  })

  it('skips an occurrence when the INSTRUCTOR is already booked (any capacity)', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    // Our instructor is primary of a session elsewhere at the 3rd Tuesday, 18:00.
    const otherRoom = await prisma.room.create({ data: { name: `rr-x-${seq}` } })
    await prisma.classSession.create({
      data: {
        classId,
        startsAt: new Date('2027-01-19T18:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2027-01-19T19:00:00Z'),
        capacity: 5,
        primaryInstructorId: instructorId,
        roomId: otherRoom.id,
      },
    })
    const { body } = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-26',
      weekdays: [TUESDAY],
      startTime: '18:00',
    })
    expect(body!.summary.created).toBe(3)
    expect(body!.skipped).toEqual([{ date: '2027-01-19', reason: 'instructor' }])
  })

  it('re-running the same request is naturally idempotent — every occurrence skips', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const args = {
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-26',
      weekdays: [TUESDAY],
      startTime: '18:00',
    }
    const first = await generate(args)
    expect(first.body!.summary.created).toBe(4)
    const second = await generate(args)
    expect(second.body!.summary.created).toBe(0)
    expect(second.body!.summary.skipped).toBe(4)
    expect(second.body!.skipped.every((s) => s.reason === 'instructor')).toBe(true)
    // Still exactly four sessions — no duplicates.
    const count = await prisma.classSession.count({ where: { classId } })
    expect(count).toBe(4)
  })
})

describe('recurring generation — validation and bounds', () => {
  it('rejects an inverted range, empty/oversized/duplicate weekdays, bad time (400)', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const base = { classId, primaryInstructorId: instructorId, roomId, startTime: '18:00' }
    expect(
      (
        await generate({
          ...base,
          startDate: '2027-02-01',
          endDate: '2027-01-01',
          weekdays: [TUESDAY],
        })
      ).status,
    ).toBe(400)
    expect(
      (await generate({ ...base, startDate: '2027-01-05', endDate: '2027-01-26', weekdays: [] }))
        .status,
    ).toBe(400)
    expect(
      (
        await generate({
          ...base,
          startDate: '2027-01-05',
          endDate: '2027-01-26',
          weekdays: [0, 1, 2, 3, 4, 5, 6, 0],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await generate({
          ...base,
          startDate: '2027-01-05',
          endDate: '2027-01-26',
          weekdays: [TUESDAY, TUESDAY],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await generate({
          ...base,
          startTime: '25:00',
          startDate: '2027-01-05',
          endDate: '2027-01-26',
          weekdays: [TUESDAY],
        })
      ).status,
    ).toBe(400)
    // A syntactically-formatted but impossible date is a clean 400, never a
    // silent rollover (2027-02-30 → Mar 2) or a misleading empty 200.
    expect(
      (
        await generate({
          ...base,
          startDate: '2027-02-30',
          endDate: '2027-03-30',
          weekdays: [TUESDAY],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await generate({
          ...base,
          startDate: '2027-13-05',
          endDate: '2027-13-26',
          weekdays: [TUESDAY],
        })
      ).status,
    ).toBe(400)
  })

  it('rejects an archived class (409), a non-instructor primary (422), a missing room (404)', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const common = {
      startDate: '2027-01-05',
      endDate: '2027-01-12',
      weekdays: [TUESDAY],
      startTime: '18:00',
    }

    const archived = await prisma.class.create({
      data: {
        title: 'Arch',
        description: 'd',
        discipline: 'y',
        defaultDurationMinutes: 60,
        defaultCapacity: 5,
        archivedAt: new Date(),
      },
    })
    expect(
      (
        await generate({
          ...common,
          classId: archived.id,
          primaryInstructorId: instructorId,
          roomId,
        })
      ).status,
    ).toBe(409)

    const staffUser = await prisma.user.create({
      data: { email: `rc-ns-${seq}@x.test`, name: 'NS', role: 'STAFF', passwordHash: 'x' },
    })
    expect(
      (await generate({ ...common, classId, primaryInstructorId: staffUser.id, roomId })).status,
    ).toBe(422)

    const ghostRoom = '00000000-0000-0000-0000-000000000000'
    expect(
      (await generate({ ...common, classId, primaryInstructorId: instructorId, roomId: ghostRoom }))
        .status,
    ).toBe(404)
  })

  it('rejects a pattern that would exceed the occurrence cap (422), including an absurd range fast', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    // 7 weekdays over ~a year ≫ 260.
    const many = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '18:00',
    })
    expect(many.status).toBe(422)

    // An adversarial 100-century range must be rejected without enumerating days.
    const t0 = Date.now()
    const absurd = await generate({
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-01',
      endDate: '9999-12-31',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '18:00',
    })
    expect(absurd.status).toBe(422)
    expect(Date.now() - t0).toBeLessThan(2000) // no per-day work before the cap
  })
})

describe('recurring generation — concurrency', () => {
  it('two identical requests in parallel create each occurrence exactly once', async () => {
    const { classId, roomId, instructorId } = await scaffold()
    const args = {
      classId,
      primaryInstructorId: instructorId,
      roomId,
      startDate: '2027-01-05',
      endDate: '2027-01-26',
      weekdays: [TUESDAY],
      startTime: '18:00',
    }
    const [r1, r2] = await Promise.all([generate(args), generate(args)])
    const totalCreated = r1.body!.summary.created + r2.body!.summary.created
    expect(totalCreated).toBe(4) // together they create the four occurrences once
    const count = await prisma.classSession.count({ where: { classId } })
    expect(count).toBe(4) // and the DB holds exactly four — no duplicates
  })
})
