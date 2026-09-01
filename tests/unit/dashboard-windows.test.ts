// tests/unit/dashboard-windows.test.ts
//
// The dashboard's day/week boundary math and the chart's zero-division guard.
// STUDIO_TIMEZONE defaults to UTC in tests, so studio-local == UTC here; the
// DST correctness of studioDateToUtc itself is proven in studio-time.test.ts.
import { describe, expect, it } from 'vitest'

import { barHeightPercent, computeWindows } from '@/server/reporting/dashboard'

const iso = (d: Date) => d.toISOString()

describe('computeWindows — studio-local day and week boundaries', () => {
  // 2026-09-16 is a Wednesday.
  const now = new Date('2026-09-16T12:00:00Z')
  const w = computeWindows(now)

  it('today is a half-open [midnight, next midnight) window', () => {
    expect(iso(w.todayStart)).toBe('2026-09-16T00:00:00.000Z')
    expect(iso(w.tomorrowStart)).toBe('2026-09-17T00:00:00.000Z')
  })

  it('this week starts on Monday and contains today', () => {
    expect(w.weekStart.getUTCDay()).toBe(1) // Monday
    expect(w.weekStart.getTime()).toBeLessThanOrEqual(w.todayStart.getTime())
    expect(w.todayStart.getTime()).toBeLessThan(w.weekEnd.getTime())
    expect(iso(w.weekStart)).toBe('2026-09-14T00:00:00.000Z')
    expect(iso(w.weekEnd)).toBe('2026-09-21T00:00:00.000Z')
  })

  it('has 9 week boundaries and 8 labels, each exactly one week apart', () => {
    expect(w.weekBoundaries).toHaveLength(9)
    expect(w.weekStartLabels).toHaveLength(8)
    for (let i = 1; i < w.weekBoundaries.length; i += 1) {
      const days =
        (w.weekBoundaries[i]!.getTime() - w.weekBoundaries[i - 1]!.getTime()) / 86_400_000
      expect(days).toBe(7)
    }
    // The last two boundaries are this Monday and next Monday.
    expect(w.weekBoundaries[7]!.getTime()).toBe(w.weekStart.getTime())
    expect(w.weekBoundaries[8]!.getTime()).toBe(w.weekEnd.getTime())
    // Labels are the studio-local Mondays, oldest → newest.
    expect(w.weekStartLabels[7]).toBe('2026-09-14')
    expect(w.weekStartLabels[0]).toBe('2026-07-27')
    // Each label matches its boundary instant.
    w.weekStartLabels.forEach((label, i) => {
      expect(iso(w.weekBoundaries[i]!).slice(0, 10)).toBe(label)
    })
  })
})

describe('barHeightPercent — zero-division guard', () => {
  it('scales to the tallest bar', () => {
    expect(barHeightPercent(5, 10)).toBe(50)
    expect(barHeightPercent(10, 10)).toBe(100)
    expect(barHeightPercent(0, 10)).toBe(0)
  })
  it('returns 0 (never NaN/Infinity) when every bar is zero', () => {
    expect(barHeightPercent(0, 0)).toBe(0)
    expect(Number.isFinite(barHeightPercent(0, 0))).toBe(true)
  })
})
