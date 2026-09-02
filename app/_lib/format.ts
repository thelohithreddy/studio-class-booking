// app/_lib/format.ts
//
// Presentation helpers. Two distinct kinds of date live in this API and they
// must be formatted differently:
//
//   • Session instants (startsAt/endsAt, booking createdAt) are real moments in
//     time (ISO-8601 with a Z). We render them in the viewer's local zone — for
//     an on-site studio machine that IS the studio's zone.
//
//   • Membership expiry is a *calendar date* delivered as UTC-midnight
//     ("2026-09-15T00:00:00.000Z") or a bare "YYYY-MM-DD". Formatting that with
//     local getters would shift it a day west of UTC. We always read it in UTC
//     so "expires the 15th" stays the 15th everywhere.

const DATETIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
const DATE: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}
const DATE_SHORT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/** A real instant → "Mon, Sep 1, 6:00 PM" in the viewer's local zone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, DATETIME)
}

/** A real instant → "6:00 PM". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, TIME)
}

/** A real instant → "Mon, Sep 1, 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, DATE)
}

/** A real instant → "Sep 1". */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, DATE_SHORT)
}

/** A session window → "6:00 – 7:00 PM" (same-day) on one line. */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`
}

/**
 * A membership expiry (UTC-midnight ISO or bare YYYY-MM-DD) → "Sep 15, 2026",
 * read in UTC so the calendar day never drifts.
 */
export function formatMembershipDate(value: string): string {
  const iso = value.length === 10 ? `${value}T00:00:00.000Z` : value
  return new Date(iso).toLocaleDateString(undefined, {
    ...DATE,
    timeZone: 'UTC',
    weekday: undefined,
  })
}

/** The calendar-date portion (YYYY-MM-DD, UTC) — for prefilling a date input. */
export function toDateInputValue(value: string): string {
  const iso = value.length === 10 ? `${value}T00:00:00.000Z` : value
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * A real instant → the value a <input type="datetime-local"> expects, expressed
 * in the viewer's local wall clock (so editing round-trips through the same zone
 * the server rendered from `new Date(local).toISOString()`).
 */
export function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "60 min" → "1h", "90 min" → "1h 30m", "45 min" → "45m". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Human relative day label for expiry copy: "in 3 days", "today", "5 days ago". */
export function formatDaysRemaining(days: number): string {
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  if (days > 1) return `expires in ${days} days`
  if (days === -1) return 'expired yesterday'
  return `expired ${Math.abs(days)} days ago`
}

/** Up to two initials from a display name, for avatars. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase()
  const firstChar = parts[0]?.[0] ?? ''
  const lastChar = parts[parts.length - 1]?.[0] ?? ''
  return (firstChar + lastChar).toUpperCase()
}

/** "1 booking" / "3 bookings". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
