// tests/unit/domain-schemas.test.ts
import { describe, expect, it } from 'vitest'

import {
  createClassSchema,
  createMemberSchema,
  createRoomSchema,
  createSessionSchema,
} from '@/lib/schemas/domain'

describe('createClassSchema', () => {
  const valid = {
    title: 'Yoga',
    description: 'Morning flow',
    discipline: 'yoga',
    defaultDurationMinutes: 60,
    defaultCapacity: 20,
  }

  it('accepts a valid class', () => {
    expect(createClassSchema.parse(valid)).toMatchObject(valid)
  })

  it('rejects an empty title', () => {
    expect(createClassSchema.safeParse({ ...valid, title: '' }).success).toBe(false)
  })

  it('rejects a non-positive duration', () => {
    expect(createClassSchema.safeParse({ ...valid, defaultDurationMinutes: 0 }).success).toBe(false)
  })

  it('rejects a negative capacity', () => {
    expect(createClassSchema.safeParse({ ...valid, defaultCapacity: -1 }).success).toBe(false)
  })

  it('rejects unknown/server-managed keys (mass assignment)', () => {
    expect(createClassSchema.safeParse({ ...valid, id: 'x', archivedAt: 'now' }).success).toBe(
      false,
    )
  })
})

describe('createMemberSchema', () => {
  const valid = { name: 'Ada', email: 'Ada@Studio.TEST', membershipExpiresOn: '2027-01-01' }

  it('normalizes the email', () => {
    expect(createMemberSchema.parse(valid).email).toBe('ada@studio.test')
  })

  it('rejects a malformed email', () => {
    expect(createMemberSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects a non-ISO date', () => {
    expect(
      createMemberSchema.safeParse({ ...valid, membershipExpiresOn: '01/01/2027' }).success,
    ).toBe(false)
  })

  it('rejects a password field (members are not users)', () => {
    expect(createMemberSchema.safeParse({ ...valid, password: 'x', role: 'STAFF' }).success).toBe(
      false,
    )
  })
})

describe('createRoomSchema', () => {
  it('trims and accepts a name', () => {
    expect(createRoomSchema.parse({ name: '  Studio A ' }).name).toBe('Studio A')
  })

  it('rejects a blank name', () => {
    expect(createRoomSchema.safeParse({ name: '   ' }).success).toBe(false)
  })
})

describe('createSessionSchema', () => {
  const valid = {
    classId: '11111111-1111-4111-8111-111111111111',
    startsAt: '2026-09-07T10:00:00Z',
    primaryInstructorId: '22222222-2222-4222-8222-222222222222',
    roomId: '33333333-3333-4333-8333-333333333333',
  }

  it('accepts a session with duration/capacity omitted (inherit)', () => {
    const parsed = createSessionSchema.parse(valid)
    expect(parsed.durationMinutes).toBeUndefined()
    expect(parsed.capacity).toBeUndefined()
  })

  it('accepts explicit overrides', () => {
    expect(
      createSessionSchema.parse({ ...valid, durationMinutes: 90, capacity: 12 }),
    ).toMatchObject({
      durationMinutes: 90,
      capacity: 12,
    })
  })

  it('accepts an offset instant and rejects a bare date or naive local time', () => {
    expect(
      createSessionSchema.safeParse({ ...valid, startsAt: '2026-09-07T10:00:00+05:30' }).success,
    ).toBe(true)
    expect(createSessionSchema.safeParse({ ...valid, startsAt: '2026-09-07' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ ...valid, startsAt: '2026-09-07 10:00' }).success).toBe(
      false,
    )
  })

  it('rejects a non-uuid classId', () => {
    expect(createSessionSchema.safeParse({ ...valid, classId: 'nope' }).success).toBe(false)
  })

  it('rejects server-managed fields (bookedCount, endsAt, id)', () => {
    expect(createSessionSchema.safeParse({ ...valid, bookedCount: 5 }).success).toBe(false)
    expect(
      createSessionSchema.safeParse({ ...valid, endsAt: '2026-09-07T11:00:00Z' }).success,
    ).toBe(false)
  })
})
