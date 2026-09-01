// src/server/domain/recurring.ts
import type { Db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { translateDbError } from '@/lib/api/db-errors'
import type { GenerateRecurringInput } from '@/lib/schemas/domain'
import { computeEndsAt } from '@/server/domain/interval'
import { studioDateTimeToUtc } from '@/server/domain/membership'
import { resolveRefs } from '@/server/domain/sessions'
import { instructorHasOverlap, lockInstructorRows } from '@/server/domain/scheduling'

/**
 * Recurring generation (Goal 7): bulk-create sessions for a class across a date
 * range from a weekly pattern (same class, instructor, room, start time), and
 * report which occurrences were CREATED and which were SKIPPED because the
 * instructor or the room was already booked in an overlapping window.
 *
 * Failure policy is PARTIAL-WITH-REPORT (Goal 7 requires exactly this — it
 * overrides the general "prefer all-or-nothing" default). Each occurrence is its
 * own transaction, so a conflicting occurrence rolls back alone and the loop
 * continues; occurrences never overlap each other (weekly), so the report always
 * reflects a valid final state. Re-running the same request is naturally
 * idempotent: every already-created slot is caught by instructorHasOverlap and
 * skipped, so no duplicates — the APPLICATION check is the dedup, the room/
 * primary exclusion constraints are only the concurrency backstop.
 */

// 260 ≈ five years on one weekday. The cap exists so a single request can never
// generate an unbounded number of sessions.
const MAX_OCCURRENCES = 260
// A cheap raw-span gate applied BEFORE any per-day work — defense in depth
// alongside the (also cheap, arithmetic) occurrence-count check.
const MAX_SPAN_DAYS = 366 * 5
const DAY_MS = 86_400_000

const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

export type SkipReason = 'instructor' | 'room'
export interface RecurringReport {
  created: { id: string; startsAt: Date }[]
  skipped: { date: string; reason: SkipReason }[]
  summary: { requested: number; created: number; skipped: number }
}

/** Midnight-UTC ms for a YYYY-MM-DD calendar day (used only for day arithmetic). */
function dayMs(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00.000Z`).getTime()
}

/**
 * Counts matching occurrences ARITHMETICALLY (O(weekdays), no per-day loop, no
 * timezone conversion) so the cap can be enforced BEFORE any occurrence is
 * materialized — an adversarial 100-year range is rejected in microseconds.
 */
function countOccurrences(startMs: number, endMs: number, weekdays: Set<number>): number {
  const totalDays = Math.floor((endMs - startMs) / DAY_MS) + 1 // inclusive
  if (totalDays <= 0) return 0
  const startDow = new Date(startMs).getUTCDay()
  let count = 0
  for (const w of weekdays) {
    const firstOffset = (w - startDow + 7) % 7 // days from start to first match
    if (firstOffset < totalDays) count += Math.floor((totalDays - 1 - firstOffset) / 7) + 1
  }
  return count
}

/** The matching calendar dates (YYYY-MM-DD), ascending. Only called after the cap passes. */
function enumerateDates(startMs: number, endMs: number, weekdays: Set<number>): string[] {
  const dates: string[] = []
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    const d = new Date(t)
    if (weekdays.has(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

export async function generateRecurringSessions(
  db: Db,
  input: GenerateRecurringInput,
): Promise<RecurringReport> {
  // Reference + policy validation (reads only, no partial state on failure):
  // class exists AND is not archived, instructor is a real INSTRUCTOR, room
  // exists. Duration/capacity inherit the class defaults when omitted (copy at
  // creation — a generated session never depends on mutable class defaults).
  const klass = await resolveRefs(db, input.classId, input.primaryInstructorId, input.roomId, {
    requireActiveClass: true,
  })
  const durationMinutes = input.durationMinutes ?? klass.defaultDurationMinutes
  const capacity = input.capacity ?? klass.defaultCapacity

  const startMs = dayMs(input.startDate)
  const endMs = dayMs(input.endDate)
  const weekdays = new Set(input.weekdays)

  // Cheap span gate first, then the exact arithmetic count — both before any
  // occurrence is built or any timezone conversion runs.
  const spanDays = Math.floor((endMs - startMs) / DAY_MS) + 1
  if (spanDays > MAX_SPAN_DAYS || countOccurrences(startMs, endMs, weekdays) > MAX_OCCURRENCES) {
    throw new ApiError(
      422,
      'too_many_occurrences',
      `A recurring pattern may generate at most ${MAX_OCCURRENCES} sessions.`,
    )
  }

  const dates = enumerateDates(startMs, endMs, weekdays)

  const created: RecurringReport['created'] = []
  const skipped: RecurringReport['skipped'] = []

  type Outcome = { skip: SkipReason } | { created: { id: string; startsAt: Date } }

  for (const date of dates) {
    // Wall-clock time in the studio timezone, DST-correct (18:00 stays 18:00
    // studio-local across a switch — see studioDateTimeToUtc).
    const startsAt = studioDateTimeToUtc(date, input.startTime)
    const endsAt = computeEndsAt(startsAt, durationMinutes)

    try {
      const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
        // Lock the primary instructor's row: this occurrence's conflict check
        // and insert are then atomic against any concurrent op touching this
        // instructor. (No session row exists to lock — each occurrence is new.)
        await lockInstructorRows(tx, [input.primaryInstructorId])
        if (await instructorHasOverlap(tx, input.primaryInstructorId, startsAt, endsAt)) {
          return { skip: 'instructor' as const }
        }
        const roomClash = await tx.classSession.findFirst({
          where: { roomId: input.roomId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          select: { id: true },
        })
        if (roomClash) return { skip: 'room' as const }

        const session = await tx.classSession.create({
          data: {
            classId: input.classId,
            startsAt,
            durationMinutes,
            endsAt,
            capacity,
            primaryInstructorId: input.primaryInstructorId,
            roomId: input.roomId,
          },
          select: { id: true, startsAt: true },
        })
        return { created: session }
      }, TX_OPTIONS)

      if ('skip' in outcome) skipped.push({ date, reason: outcome.skip })
      else created.push(outcome.created)
    } catch (err) {
      // A concurrent insert that slipped past the pre-check trips the room or
      // primary-instructor exclusion constraint (23P01) → that occurrence is a
      // skip, not a failure. Anything else is unexpected: fail loud (retry is
      // safe — already-created occurrences skip via natural idempotency).
      const translated = translateDbError(err)
      if (translated?.code === 'room_conflict') skipped.push({ date, reason: 'room' })
      else if (translated?.code === 'instructor_conflict')
        skipped.push({ date, reason: 'instructor' })
      else throw err
    }
  }

  return {
    created,
    skipped,
    summary: { requested: dates.length, created: created.length, skipped: skipped.length },
  }
}
