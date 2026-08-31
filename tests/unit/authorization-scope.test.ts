// tests/unit/authorization-scope.test.ts
import { describe, expect, it } from 'vitest'

import { bookingScopeWhere, sessionScopeWhere } from '@/server/authorization/scope'
import type { SessionUser } from '@/server/auth/session'

const staff: SessionUser = { id: 'staff-id', email: 's@x.test', name: 'S', role: 'STAFF' }
const instructor: SessionUser = { id: 'inst-id', email: 'i@x.test', name: 'I', role: 'INSTRUCTOR' }

describe('sessionScopeWhere', () => {
  it('staff: an empty fragment — every session is in scope', () => {
    expect(sessionScopeWhere(staff)).toEqual({})
  })

  it('instructor: primary OR co-instructor, keyed to the server-resolved id', () => {
    expect(sessionScopeWhere(instructor)).toEqual({
      OR: [
        { primaryInstructorId: 'inst-id' },
        { coInstructors: { some: { instructorId: 'inst-id' } } },
      ],
    })
  })
})

describe('bookingScopeWhere (derived from sessionScopeWhere)', () => {
  it('staff: an empty fragment — every booking is in scope', () => {
    expect(bookingScopeWhere(staff)).toEqual({})
  })

  it('instructor: a booking is visible iff its session is', () => {
    // Structurally derived, not a hand-copied predicate — so Goal 6's future
    // scoped booking count inherits the non-leak property.
    expect(bookingScopeWhere(instructor)).toEqual({ session: sessionScopeWhere(instructor) })
  })
})
