// src/server/domain/attendance.ts
import type { Db } from '@/lib/db'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { parseIdOr404 } from '@/server/domain/ids'
import { toCsv } from '@/server/reporting/csv'

/**
 * Goal 7 (second half): "export a session's attendance — every booking with its
 * member and final status — as a CSV file." Staff-only (decisions.md #17); the
 * route's capability guard runs BEFORE this, so a non-staff caller never reaches
 * a byte of data. This function is the data boundary: it scopes the query to the
 * ONE requested session (`where: { sessionId }`) BEFORE selecting or serializing
 * — it can never read another session's or global bookings.
 *
 * ONE ROW = one booking of the session, in every status (BOOKED, WAITLISTED,
 * CANCELLED, ATTENDED, NO_SHOW) — the complete attendance picture. Columns are
 * exactly the member and the final status; nothing else is selected, and members
 * have no credential/secret columns at all (decisions.md #7), so none can leak.
 */

// The attendance of a single session is naturally bounded (active bookings ≤
// capacity + waitlist, plus historical cancellations). This cap is a defensive
// DoS bound only — the client cannot influence the size (there are no query
// params); it is effectively unreachable, and exceeding it is a clean 413 rather
// than an unbounded in-memory string. Overridable per call (the `maxRows`
// parameter) only so a test can exercise the 413 path without a 10 000-row fixture.
const MAX_EXPORT_ROWS = 10_000

// Explicit, stable, ordered — never derived from DB column names.
const HEADER = ['Member Name', 'Member Email', 'Status'] as const

/** Formats an instant as a YYYY-MM-DD calendar date in the studio timezone (a
 * safe, server-derived charset for the download filename). */
function studioLocalDate(instant: Date): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env().STUDIO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

export interface AttendanceCsv {
  filename: string
  body: string
}

export async function exportSessionAttendanceCsv(
  db: Db,
  sessionId: string,
  maxRows: number = MAX_EXPORT_ROWS,
): Promise<AttendanceCsv> {
  const validId = parseIdOr404(sessionId, 'Session not found.')

  // A missing session is a 404 (existence-hiding, consistent with the rest of
  // the API) — NOT an empty CSV. Staff may export any session, so no per-caller
  // scope is applied beyond the session id itself.
  const session = await db.classSession.findUnique({
    where: { id: validId },
    select: { id: true, startsAt: true },
  })
  if (!session) throw new ApiError(404, 'not_found', 'Session not found.')

  // Scoped to THIS session, only the required fields, deterministic order. `seq`
  // is a unique monotonic serial (sign-up order), so it is already a total order
  // — no tiebreaker needed. The nested `member` select is a to-one relation that
  // Prisma loads in a single query (no N+1).
  const bookings = await db.booking.findMany({
    where: { sessionId: validId },
    orderBy: { seq: 'asc' },
    take: maxRows + 1, // one past the cap, so an overflow is detectable
    select: { status: true, member: { select: { name: true, email: true } } },
  })
  if (bookings.length > maxRows) {
    throw new ApiError(
      413,
      'payload_too_large',
      'This session has too many bookings to export at once.',
    )
  }

  const rows = bookings.map((b) => [b.member.name, b.member.email, b.status])
  const filename = `attendance-${studioLocalDate(session.startsAt)}-${validId}.csv`
  return { filename, body: toCsv(HEADER, rows) }
}
