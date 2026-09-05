// src/server/auth/demo.ts
import type { UserRole } from '@/generated/prisma/enums'
import { env } from '@/lib/env'

/**
 * One-click demo entry for evaluators. This is a DELIBERATE, deployment-scoped
 * convenience — not an authentication change:
 *
 *   - It is OFF unless ALLOW_DEMO_LOGIN is exactly "true". A real studio
 *     deployment leaves it unset, and POST /api/auth/demo then 404s, so this can
 *     never become a credential-free way into a production studio.
 *   - When on, it mints a normal session (the SAME opaque DB-backed session as a
 *     password login) for ONE of a FIXED set of pre-seeded demo accounts, chosen
 *     by role. It never accepts an email/id from the client, never creates an
 *     account, and never escalates anyone — it simply signs the visitor in as the
 *     already-seeded demo staff or demo instructor so both role experiences can be
 *     evaluated without a password ever reaching the client.
 *
 * The accounts below are exactly the ones `scripts/seed-dev.mjs` creates.
 */
export const DEMO_ACCOUNT_EMAILS: Record<UserRole, string> = {
  STAFF: 'staff@studio.test',
  INSTRUCTOR: 'ivy@studio.test',
}

/** True only when the deployment has explicitly opted into demo entry. */
export function demoLoginEnabled(): boolean {
  return env().ALLOW_DEMO_LOGIN === 'true'
}
