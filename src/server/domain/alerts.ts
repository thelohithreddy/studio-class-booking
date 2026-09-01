// src/server/domain/alerts.ts
import type { Db } from '@/lib/db'
import type { SessionUser } from '@/server/auth/session'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import { parseIdOr404 } from '@/server/domain/ids'
import { studioToday } from '@/server/domain/membership'
import type { MembershipAlertsDto } from '@/lib/alerts-dto'

/**
 * Membership expiry alerts (Goal 10). STAFF-ONLY (the routes gate on
 * member:manage / alert:dismiss). Alerts are DYNAMICALLY COMPUTED, never stored:
 * a member is alerted iff their CURRENT expiry date is within the window AND no
 * dismissal row matches that exact expiry value (decisions.md #11). This means
 * date rollover and membership edits are reflected on the next read with no
 * background job — and extending a dismissed member's expiry makes the alert
 * return by construction (the dismissal is keyed to the old expiry value).
 *
 * Eligibility (date-only, studio-local): membershipExpiresOn <= studioToday + 7.
 * The one inequality captures both clauses of the brief — "has already passed"
 * (expiry < today) and "within the next seven days" (today..today+7 inclusive of
 * the 7th day, and of today itself). membership_expires_on is a @db.Date, so the
 * comparison is pure date-to-date: no time-of-day, no timezone drift.
 */

const ALERT_WINDOW_DAYS = 7

/** A calendar date (YYYY-MM-DD) shifted by whole days — pure UTC-midnight
 * arithmetic (UTC has no DST), applied to studioToday's studio-local date. */
function isoDatePlusDays(midnightUtc: Date, days: number): string {
  return new Date(midnightUtc.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

export async function listMembershipAlerts(
  db: Db,
  now: Date = new Date(),
): Promise<MembershipAlertsDto> {
  const today = studioToday(now) // UTC-midnight Date representing the studio-local date
  const todayIso = today.toISOString().slice(0, 10)
  const cutoffIso = isoDatePlusDays(today, ALERT_WINDOW_DAYS)

  // One bounded, parameterized query. The correlated NOT EXISTS on the member's
  // OWN expiry value is what makes the dismissal expiry-keyed (Prisma cannot
  // express that correlation, hence raw SQL). days_remaining is `date - date` =
  // an integer (JS number, never BigInt). to_char keeps the wire value a clean
  // date string rather than a timezone-fragile pg Date.
  const rows = await db.$queryRaw<
    { member_id: string; name: string; membership_expires_on: string; days_remaining: number }[]
  >`
    SELECT m.id AS member_id,
           m.name,
           to_char(m.membership_expires_on, 'YYYY-MM-DD') AS membership_expires_on,
           (m.membership_expires_on - ${todayIso}::date) AS days_remaining
    FROM members m
    WHERE m.membership_expires_on <= ${cutoffIso}::date
      AND NOT EXISTS (
        SELECT 1 FROM membership_alert_dismissals d
        WHERE d.member_id = m.id AND d.membership_expires_on = m.membership_expires_on
      )
    ORDER BY m.membership_expires_on ASC, m.name ASC, m.id ASC`

  const alerts = rows.map((r) => ({
    memberId: r.member_id,
    name: r.name,
    membershipExpiresOn: r.membership_expires_on,
    daysRemaining: r.days_remaining,
  }))
  return { alerts, count: alerts.length }
}

/**
 * Dismisses the alert for a member's CURRENT expiry value. Staff-only (guarded at
 * the route). The dismissed expiry comes from the DB (server-authoritative — a
 * stale client cannot dismiss a value the member no longer has) and the actor
 * from the SessionUser — never from the request body. Idempotent and
 * concurrency-safe: the @@unique([memberId, membershipExpiresOn]) constraint plus
 * skipDuplicates (ON CONFLICT DO NOTHING) means a repeat or two simultaneous
 * dismissals leave exactly one row, no duplicate, no error.
 */
export async function dismissMembershipAlert(
  db: Db,
  actor: SessionUser,
  memberId: string,
  now: Date = new Date(),
): Promise<void> {
  const validId = parseIdOr404(memberId, 'Member not found.')
  const member = await db.member.findUnique({
    where: { id: validId },
    select: { membershipExpiresOn: true },
  })
  if (!member) throw new ApiError(404, 'not_found', 'Member not found.')

  // Only a member whose CURRENT expiry is actually within the alert window can be
  // dismissed. Recording a dismissal for a non-eligible (e.g. far-future) value
  // would PERMANENTLY suppress the alert when that same date later rolls into the
  // window — violating Goal 10's "if staff set a new, later expiry date and that
  // date later falls within seven days again, the alert returns." So a dismiss of
  // a non-eligible member is a graceful no-op (there is no alert to dismiss), which
  // keeps decisions.md #11's invariant that a dismissal row only ever exists for a
  // value that was actually alerted. Same date-only comparison as the list query
  // (both are UTC-midnight @db.Date instants representing calendar dates).
  const cutoff = new Date(studioToday(now).getTime() + ALERT_WINDOW_DAYS * 86_400_000)
  if (member.membershipExpiresOn.getTime() > cutoff.getTime()) return

  await withDbErrors(() =>
    db.membershipAlertDismissal.createMany({
      data: [
        {
          memberId: validId,
          membershipExpiresOn: member.membershipExpiresOn,
          dismissedById: actor.id,
        },
      ],
      skipDuplicates: true,
    }),
  )
}
