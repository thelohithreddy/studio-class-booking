// src/server/authorization/policy.ts
import type { UserRole } from '@/generated/prisma/enums'
import type { SessionUser } from '@/server/auth/session'

/**
 * Capabilities are the role-gated verbs of the system. Every management action
 * the brief assigns to studio staff is a capability here, and the table below
 * is the single, greppable answer to "who may do X" — not a role===STAFF check
 * scattered across a dozen routes.
 *
 * Today every capability is staff-only: Goal 1 denies instructors every
 * management verb (create/edit/archive classes, schedule sessions, manage
 * members, create/cancel/settle bookings, add co-instructors, generate
 * schedules, export, studio dashboard, dismiss alerts). Making each denial an
 * explicit table row — rather than an absent check — is what makes it testable
 * and what makes adding a future instructor verb a visible, reviewed edit.
 */
export type Capability =
  | 'class:manage'
  | 'session:manage'
  | 'member:manage'
  | 'room:manage'
  | 'booking:manage'
  | 'coinstructor:manage'
  | 'recurring:generate'
  | 'attendance:export'
  | 'dashboard:studio'
  | 'alert:dismiss'

const CAPABILITY_ROLES: Record<Capability, readonly UserRole[]> = {
  'class:manage': ['STAFF'],
  'session:manage': ['STAFF'],
  'member:manage': ['STAFF'],
  'room:manage': ['STAFF'],
  'booking:manage': ['STAFF'],
  'coinstructor:manage': ['STAFF'],
  'recurring:generate': ['STAFF'],
  'attendance:export': ['STAFF'],
  'dashboard:studio': ['STAFF'],
  'alert:dismiss': ['STAFF'],
}

/**
 * Pure role→capability decision. Fail-closed: an unknown capability (only
 * reachable via a type-cast bypass) resolves to the empty role list, so the
 * answer is "no". Identity and role come from the caller's server-resolved
 * SessionUser — never from anything client-supplied.
 */
export function can(user: SessionUser, capability: Capability): boolean {
  const allowed = CAPABILITY_ROLES[capability] ?? []
  return allowed.includes(user.role)
}

/** The full table, for documentation and snapshot tests. */
export const CAPABILITIES = Object.keys(CAPABILITY_ROLES) as Capability[]
export { CAPABILITY_ROLES }
