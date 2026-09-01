// src/lib/dashboard-dto.ts
//
// The dashboard's wire contract + one pure UI helper. Kept free of any server
// import (no Prisma, no db) so the client dashboard view can share the exact
// types and the bar-scaling math without pulling the aggregation module — and
// its Prisma client — into the browser bundle. `BookingStatus` is a type-only
// import (erased at compile), so it carries no runtime dependency.
import type { BookingStatus } from '@/generated/prisma/enums'

export interface DashboardDto {
  generatedAt: string
  timezone: string
  headline: {
    sessionsToday: number
    bookingsMadeToday: number
    noShowsThisWeek: number
    membersWaitlisted: number
  }
  bookingsByStatus: { status: BookingStatus; count: number }[]
  bookingsByClass: { classId: string; classTitle: string; count: number }[]
  attendanceByWeek: { weekStart: string; attended: number }[]
}

/** Bar height as a percentage of the tallest bar, guarding the all-zero case
 * (max === 0) so the chart never renders NaN. */
export function barHeightPercent(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0
}
