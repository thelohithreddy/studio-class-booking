// tests/integration/client.test.ts
//
// Proves the generated Prisma client behaves correctly against the migrated
// schema — including the properties the schema review demanded: the password
// hash never leaves the database by default, DB-generated ids work through
// the client, and the append-only trigger stops Prisma's own update/delete.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

import { createPrismaClient } from '@/lib/db'
import { BookingStatus, UserRole } from '@/generated/prisma/enums'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe('password hash containment (AM6)', () => {
  it('omits passwordHash from a default user read', async () => {
    const created = await prisma.user.create({
      data: { email: 'omit@x.test', name: 'Omit', role: UserRole.STAFF, passwordHash: 'secret' },
    })
    expect(created).not.toHaveProperty('passwordHash')

    const found = await prisma.user.findFirst({ where: { email: 'omit@x.test' } })
    expect(found).not.toBeNull()
    expect(found).not.toHaveProperty('passwordHash')
    // The column itself exists and is populated — only the client omits it.
    const raw = await pool.query(`SELECT password_hash FROM users WHERE email = 'omit@x.test'`)
    expect(raw.rows[0].password_hash).toBe('secret')
  })

  it('omits passwordHash when a user is joined as a relation', async () => {
    const staff = await prisma.user.create({
      data: { email: 'actor@x.test', name: 'Actor', role: UserRole.STAFF, passwordHash: 'secret' },
    })
    const member = await prisma.member.create({
      data: {
        name: 'M',
        email: 'm@x.test',
        membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
      },
    })
    const dismissal = await prisma.membershipAlertDismissal.create({
      data: {
        memberId: member.id,
        membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
        dismissedById: staff.id,
      },
      include: { dismissedBy: true },
    })
    expect(dismissal.dismissedBy).not.toHaveProperty('passwordHash')
  })
})

describe('generated client fundamentals', () => {
  it('returns DB-generated uuid ids and UTC-midnight dates', async () => {
    const member = await prisma.member.create({
      data: {
        name: 'Dates',
        email: 'dates@x.test',
        // App rule A10: DATE values are built as UTC midnight — @db.Date
        // truncates on the UTC calendar day.
        membershipExpiresOn: new Date('2026-09-15T00:00:00Z'),
      },
    })
    expect(member.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(member.membershipExpiresOn.toISOString()).toBe('2026-09-15T00:00:00.000Z')
  })

  it('round-trips enums as values', async () => {
    const room = await prisma.room.create({ data: { name: 'Client Room' } })
    const instructor = await prisma.user.create({
      data: { email: 'i@x.test', name: 'I', role: UserRole.INSTRUCTOR, passwordHash: 'x' },
    })
    const klass = await prisma.class.create({
      data: {
        title: 'T',
        description: 'D',
        discipline: 'yoga',
        defaultDurationMinutes: 60,
        defaultCapacity: 10,
      },
    })
    const session = await prisma.classSession.create({
      data: {
        classId: klass.id,
        startsAt: new Date('2026-09-07T10:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2026-09-07T11:00:00Z'),
        capacity: 10,
        primaryInstructorId: instructor.id,
        roomId: room.id,
      },
    })
    const member = await prisma.member.create({
      data: { name: 'E', email: 'e@x.test', membershipExpiresOn: new Date('2027-01-01T00:00:00Z') },
    })
    const booking = await prisma.booking.create({
      data: { sessionId: session.id, memberId: member.id, status: BookingStatus.WAITLISTED },
    })
    expect(booking.status).toBe(BookingStatus.WAITLISTED)
    expect(booking.status).toBe('WAITLISTED')
  })

  it("cannot update or delete booking events through Prisma's own API (I8)", async () => {
    const staff = await prisma.user.create({
      data: { email: 's@x.test', name: 'S', role: UserRole.STAFF, passwordHash: 'x' },
    })
    const room = await prisma.room.create({ data: { name: 'R' } })
    const klass = await prisma.class.create({
      data: {
        title: 'T',
        description: 'D',
        discipline: 'yoga',
        defaultDurationMinutes: 60,
        defaultCapacity: 10,
      },
    })
    const session = await prisma.classSession.create({
      data: {
        classId: klass.id,
        startsAt: new Date('2026-09-07T10:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2026-09-07T11:00:00Z'),
        capacity: 10,
        primaryInstructorId: staff.id,
        roomId: room.id,
      },
    })
    const member = await prisma.member.create({
      data: {
        name: 'M',
        email: 'mm@x.test',
        membershipExpiresOn: new Date('2027-01-01T00:00:00Z'),
      },
    })
    const booking = await prisma.booking.create({
      data: { sessionId: session.id, memberId: member.id, status: BookingStatus.BOOKED },
    })
    const event = await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'CREATED',
        toStatus: BookingStatus.BOOKED,
        actorUserId: staff.id,
      },
    })

    await expect(
      prisma.bookingEvent.update({ where: { id: event.id }, data: { note: 'rewritten' } }),
    ).rejects.toThrow(/append-only/)
    await expect(prisma.bookingEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    )
  })
})
