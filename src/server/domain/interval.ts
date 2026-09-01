// src/server/domain/interval.ts

/**
 * Half-open interval overlap: [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd. Adjacency (aEnd === bStart) does NOT
 * overlap; same-start, partial, contained and containing all do. This mirrors
 * the Phase-2 GiST exclusion constraints (tstzrange '[)'); the constraint is
 * the race-safe backstop, this is the friendly pre-check.
 */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/** endsAt = startsAt + durationMinutes, matching the class_sessions CHECK. */
export function computeEndsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000)
}
