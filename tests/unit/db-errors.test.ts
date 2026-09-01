// tests/unit/db-errors.test.ts
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'
import { translateDbError } from '@/lib/api/db-errors'

/**
 * These shapes are NOT invented — they are exactly what Prisma 7 over
 * @prisma/adapter-pg throws, captured by triggering each real constraint
 * against the migrated database (see docs/decisions.md #18). The integration
 * tests additionally trigger the live violations end-to-end; this pins the
 * pure mapping.
 */
const unique = {
  code: 'P2002',
  meta: {
    driverAdapterError: { cause: { code: '23505', constraint: { index: 'rooms_name_ci_unique' } } },
  },
}
const fk = {
  code: 'P2003',
  meta: {
    driverAdapterError: {
      cause: { code: '23503', constraint: { index: 'bookings_session_id_fkey' } },
    },
  },
}
const roomOverlap = {
  code: 'P2039',
  meta: {
    driverAdapterError: {
      cause: {
        code: '23P01',
        message:
          'conflicting key value violates exclusion constraint "class_sessions_room_no_overlap"',
      },
    },
  },
}
const instructorOverlap = {
  code: 'P2039',
  meta: {
    driverAdapterError: {
      cause: {
        code: '23P01',
        message:
          'conflicting key value violates exclusion constraint "class_sessions_primary_instructor_no_overlap"',
      },
    },
  },
}
const check = {
  code: 'P2039',
  meta: {
    driverAdapterError: {
      cause: {
        code: '23514',
        message:
          'new row for relation "class_sessions" violates check constraint "class_sessions_booked_count_within_capacity"',
      },
    },
  },
}

describe('translateDbError', () => {
  it('maps a unique violation (P2002) to 409', () => {
    const e = translateDbError(unique, { conflict: 'dup' })
    expect(e).toBeInstanceOf(ApiError)
    expect(e?.status).toBe(409)
    expect(e?.message).toBe('dup')
  })

  it('maps a foreign-key violation (P2003) to 409', () => {
    expect(translateDbError(fk, { conflict: 'has refs' })?.status).toBe(409)
  })

  it('splits P2039 exclusion (23P01) into a 409 room_conflict', () => {
    const e = translateDbError(roomOverlap)
    expect(e?.status).toBe(409)
    expect(e?.code).toBe('room_conflict')
  })

  it('splits P2039 exclusion into a 409 instructor_conflict', () => {
    const e = translateDbError(instructorOverlap)
    expect(e?.status).toBe(409)
    expect(e?.code).toBe('instructor_conflict')
  })

  it('splits P2039 check (23514) into a 422', () => {
    const e = translateDbError(check, { check: 'too small' })
    expect(e?.status).toBe(422)
    expect(e?.message).toBe('too small')
  })

  it('returns null for a non-constraint error (handled generically upstream)', () => {
    expect(translateDbError(new Error('boom'))).toBeNull()
    expect(translateDbError({ code: 'P2007' })).toBeNull() // bad uuid — pre-validated elsewhere
  })

  it('never echoes constraint names or PG text into the client message', () => {
    for (const e of [roomOverlap, instructorOverlap, check, unique, fk].map((x) =>
      translateDbError(x),
    )) {
      expect(e?.message).not.toMatch(/class_sessions|constraint|23P01|23514|violates|Failing row/i)
    }
  })
})
