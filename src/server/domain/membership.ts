// src/server/domain/membership.ts
import { env } from '@/lib/env'

/**
 * The current calendar date in the studio's timezone, as a UTC-midnight Date
 * — the same shape membershipExpiresOn is stored in (@db.Date, rule A10). Using
 * the studio timezone (not the server's) means "today" is the studio's day,
 * so a membership expiring today is judged consistently wherever the server runs.
 */
export function studioToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env().STUDIO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  // en-CA formats as YYYY-MM-DD.
  return new Date(`${parts}T00:00:00.000Z`)
}

/**
 * A membership is valid for booking through its expiry date inclusive: it has
 * "passed" (Goal 4) only once the expiry date is before today. So expires today
 * → still valid; expires yesterday → expired.
 */
export function isMembershipValid(membershipExpiresOn: Date, now: Date = new Date()): boolean {
  return membershipExpiresOn.getTime() >= studioToday(now).getTime()
}

/**
 * The offset (ms) by which the given instant's civil time in `tz` runs ahead
 * of UTC — computed at that specific instant, so DST is handled correctly.
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - instant.getTime()
}

/**
 * Converts a calendar date (YYYY-MM-DD) to the UTC instant of MIDNIGHT on that
 * date in STUDIO_TIMEZONE. So a "from"/"to" the studio types as September 1 is
 * September 1 in the studio's own day, not the server's — consistent with how
 * membership expiry is judged. DST-correct (the offset is taken at the date).
 */
export function studioDateToUtc(isoDate: string, now: Date = new Date()): Date {
  void now
  const tz = env().STUDIO_TIMEZONE
  const naiveUtcMs = new Date(`${isoDate}T00:00:00.000Z`).getTime()
  return new Date(naiveUtcMs - tzOffsetMs(new Date(naiveUtcMs), tz))
}

/**
 * Converts a studio-local wall-clock date + time (YYYY-MM-DD, HH:MM) to the UTC
 * instant at which that wall clock reads in STUDIO_TIMEZONE. Recurring
 * generation depends on this: a weekly "18:00 every Tuesday" is a WALL-CLOCK
 * pattern, so each occurrence must stay 18:00 studio-local even across a DST
 * switch (the UTC instant shifts by the offset change) — naive `start + 7×24h`
 * arithmetic would drift the wall clock by an hour when the clocks change
 * mid-term. Thin wrapper over zonedWallClockToUtc bound to the studio zone.
 */
export function studioDateTimeToUtc(isoDate: string, timeStr: string): Date {
  return zonedWallClockToUtc(isoDate, timeStr, env().STUDIO_TIMEZONE)
}

/**
 * The timezone-explicit core of studioDateTimeToUtc (exported so it can be
 * unit-tested across real zones without stubbing the env singleton).
 *
 * We seek the instant U whose local time in `tz` equals the target wall clock W:
 *   localtime(U) = U + offset(U) = W, so U = W − offset(U).
 * The offset depends on U and is a two-valued step function around any DST
 * transition, so we BRACKET the transition — sample the offset ~a day before and
 * ~a day after the target (each safely clear of the ~1-hour transition window),
 * which yields the two offsets in effect around it, INDEPENDENT of the offset's
 * sign (an earlier single-sample version silently returned the daylight instant
 * for behind-UTC zones):
 *   - The two samples AGREE → no transition nearby → the single candidate is exact
 *     (every real class time).
 *   - They DISAGREE → the target is transition-adjacent, with a candidate per
 *     offset (uA = W − oBefore, uB = W − oAfter). A candidate is valid iff its own
 *     local time reads back as W. Both valid → AMBIGUOUS (fall-back overlap): resolve
 *     to the later, standard-time (second) occurrence. Exactly one valid → that is
 *     the wall time's unique instant. Neither valid → NONEXISTENT (spring-forward
 *     gap, e.g. 02:30 on the skip day): resolve FORWARD (the later candidate), the
 *     common civil convention. The gap/fold branches govern only a pathological
 *     input — a class whose start time is the switch hour itself; unit-tested in
 *     both a positive- and a negative-offset zone, in both transition directions.
 */
export function zonedWallClockToUtc(isoDate: string, timeStr: string, tz: string): Date {
  const [h, m] = timeStr.split(':').map(Number) as [number, number]
  const naiveUtcMs = new Date(`${isoDate}T00:00:00.000Z`).getTime() + (h * 60 + m) * 60_000
  const DAY_MS = 86_400_000

  // The two offsets in effect around the target day's (at most one) transition.
  const oBefore = tzOffsetMs(new Date(naiveUtcMs - DAY_MS), tz)
  const oAfter = tzOffsetMs(new Date(naiveUtcMs + DAY_MS), tz)
  if (oBefore === oAfter) return new Date(naiveUtcMs - oBefore) // no transition nearby → exact

  const uBefore = naiveUtcMs - oBefore
  const uAfter = naiveUtcMs - oAfter
  const validBefore = tzOffsetMs(new Date(uBefore), tz) === oBefore
  const validAfter = tzOffsetMs(new Date(uAfter), tz) === oAfter
  if (validBefore && validAfter) return new Date(Math.max(uBefore, uAfter)) // fold → standard-time
  if (validBefore) return new Date(uBefore)
  if (validAfter) return new Date(uAfter)
  return new Date(Math.max(uBefore, uAfter)) // gap → push forward
}
