// src/lib/alerts-dto.ts
//
// The membership-alerts wire contract. Kept free of any server import (no Prisma,
// no db) so the client alerts UI (provider, badge, list) can share the exact
// types without pulling the domain module — and its Prisma client — into the
// browser bundle.

export interface MembershipAlert {
  memberId: string
  name: string
  /** The member's current membership expiry as a studio-local calendar date (YYYY-MM-DD). */
  membershipExpiresOn: string
  /** Whole days from studio-local today to expiry: <0 expired, 0 today, 1..7 expiring soon. */
  daysRemaining: number
}

export interface MembershipAlertsDto {
  alerts: MembershipAlert[]
  count: number
}
