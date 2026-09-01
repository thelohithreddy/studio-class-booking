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
