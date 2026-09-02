// tests/unit/authorization-policy.test.ts
import { describe, expect, it } from 'vitest'

import { CAPABILITIES, CAPABILITY_ROLES, can } from '@/server/authorization/policy'
import type { Capability } from '@/server/authorization/policy'
import type { SessionUser } from '@/server/auth/session'

const staff: SessionUser = { id: 's', email: 's@x.test', name: 'S', role: 'STAFF' }
const instructor: SessionUser = { id: 'i', email: 'i@x.test', name: 'I', role: 'INSTRUCTOR' }

describe('capability policy', () => {
  it('grants staff every capability; grants instructors ONLY attendance:settle', () => {
    for (const capability of CAPABILITIES) {
      expect(can(staff, capability)).toBe(true)
      // Goal 1: an instructor records attendance ("who actually showed up") and
      // nothing else at the role gate; every other management verb stays staff-only.
      expect(can(instructor, capability)).toBe(capability === 'attendance:settle')
    }
  })

  it('every capability is staff-only except attendance:settle (STAFF + INSTRUCTOR)', () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_ROLES[capability]).toEqual(
        capability === 'attendance:settle' ? ['STAFF', 'INSTRUCTOR'] : ['STAFF'],
      )
    }
  })

  it('fails closed on an unknown capability reachable only by a type-cast bypass', () => {
    expect(can(staff, 'totally:made-up' as Capability)).toBe(false)
    expect(can(instructor, 'totally:made-up' as Capability)).toBe(false)
  })
})
