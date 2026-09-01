// app/api/sessions/generate/route.ts
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { generateRecurringSchema } from '@/lib/schemas/domain'
import { generateRecurringSessions } from '@/server/domain/recurring'

/**
 * POST /api/sessions/generate — bulk-generate recurring sessions (STAFF only,
 * recurring:generate). Body is a weekly pattern (class, instructor, room, start
 * time, weekday set, date range) parsed through a .strict() schema. The response
 * is a PARTIAL report (Goal 7): the sessions created plus the occurrences skipped
 * because the instructor or room was already booked — never a raw error, and
 * never an all-or-nothing failure. Occurrence count is capped and checked before
 * any session is built.
 */
export const POST = handleRoute(async (req) => {
  await requireCapability(req, 'recurring:generate')
  const input = generateRecurringSchema.parse(await req.json().catch(() => ({})))
  return Response.json(await generateRecurringSessions(db(), input))
})
