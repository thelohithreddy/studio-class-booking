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
