// src/server/authorization/policy.ts
import type { UserRole } from '@/generated/prisma/enums'
import type { SessionUser } from '@/server/auth/session'

/**
 * Capabilities are the role-gated verbs of the system. Every management action
 * the brief assigns to studio staff is a capability here, and the table below
 * is the single, greppable answer to "who may do X" — not a role===STAFF check
 * scattered across a dozen routes.
 *
 * Every management verb is staff-only EXCEPT `attendance:settle`: Goal 1 lets
 * an instructor "record who actually showed up" on the sessions they teach, so
 * settlement is granted to STAFF and INSTRUCTOR here. Role is only the first
 * gate — an instructor may settle ONLY a booking on one of their own sessions,
 * an object-level check enforced in the domain via bookingScopeWhere (staff:
 * any; instructor: primary- or co-taught). Every OTHER booking verb
 * (create/cancel/notes) stays staff-only. Making each grant an explicit table
 * row — rather than an absent check — is what makes it testable.
 */
export type Capability =
  | 'class:manage'
  | 'session:manage'
  | 'member:manage'
  | 'room:manage'
  | 'booking:manage'
  | 'attendance:settle'
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
  // Attendance recording is the one verb Goal 1 grants instructors — scoped to
  // their own sessions by the object-level check in settleBooking().
  'attendance:settle': ['STAFF', 'INSTRUCTOR'],
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
