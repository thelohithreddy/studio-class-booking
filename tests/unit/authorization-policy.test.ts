// tests/unit/authorization-policy.test.ts
import { describe, expect, it } from 'vitest'

import { CAPABILITIES, CAPABILITY_ROLES, can } from '@/server/authorization/policy'
import type { Capability } from '@/server/authorization/policy'
import type { SessionUser } from '@/server/auth/session'

const staff: SessionUser = { id: 's', email: 's@x.test', name: 'S', role: 'STAFF' }
const instructor: SessionUser = { id: 'i', email: 'i@x.test', name: 'I', role: 'INSTRUCTOR' }

describe('capability policy', () => {
  it('grants staff every capability and instructors none (full-table snapshot)', () => {
    for (const capability of CAPABILITIES) {
      expect(can(staff, capability)).toBe(true)
      expect(can(instructor, capability)).toBe(false)
    }
  })

  it('every capability is declared staff-only — Goal 1 denies instructors all management verbs', () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_ROLES[capability]).toEqual(['STAFF'])
    }
  })

  it('fails closed on an unknown capability reachable only by a type-cast bypass', () => {
    expect(can(staff, 'totally:made-up' as Capability)).toBe(false)
    expect(can(instructor, 'totally:made-up' as Capability)).toBe(false)
  })
})
