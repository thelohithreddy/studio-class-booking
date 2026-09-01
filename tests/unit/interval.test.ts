// tests/unit/interval.test.ts
import { describe, expect, it } from 'vitest'

import { computeEndsAt, intervalsOverlap } from '@/server/domain/interval'

const at = (iso: string) => new Date(iso)

describe('intervalsOverlap (half-open [start, end))', () => {
  const base: [Date, Date] = [at('2026-09-07T10:00:00Z'), at('2026-09-07T11:00:00Z')]

  const cases: Array<[string, Date, Date, boolean]> = [
    ['adjacent after (11:00–12:00)', at('2026-09-07T11:00:00Z'), at('2026-09-07T12:00:00Z'), false],
    [
      'adjacent before (09:00–10:00)',
      at('2026-09-07T09:00:00Z'),
      at('2026-09-07T10:00:00Z'),
      false,
    ],
    ['same start (10:00–11:00)', at('2026-09-07T10:00:00Z'), at('2026-09-07T11:00:00Z'), true],
    ['partial overlap (10:59–12:00)', at('2026-09-07T10:59:00Z'), at('2026-09-07T12:00:00Z'), true],
    ['contained (10:15–10:45)', at('2026-09-07T10:15:00Z'), at('2026-09-07T10:45:00Z'), true],
    ['containing (09:00–12:00)', at('2026-09-07T09:00:00Z'), at('2026-09-07T12:00:00Z'), true],
    ['fully before (08:00–09:00)', at('2026-09-07T08:00:00Z'), at('2026-09-07T09:00:00Z'), false],
    ['fully after (12:00–13:00)', at('2026-09-07T12:00:00Z'), at('2026-09-07T13:00:00Z'), false],
  ]

  for (const [name, bStart, bEnd, expected] of cases) {
    it(`${name} → ${expected ? 'conflict' : 'no conflict'}`, () => {
      expect(intervalsOverlap(base[0], base[1], bStart, bEnd)).toBe(expected)
      // Symmetric.
      expect(intervalsOverlap(bStart, bEnd, base[0], base[1])).toBe(expected)
    })
  }
})

describe('computeEndsAt', () => {
  it('adds the duration in minutes', () => {
    expect(computeEndsAt(at('2026-09-07T10:00:00Z'), 90).toISOString()).toBe(
      '2026-09-07T11:30:00.000Z',
    )
  })

  it('handles a non-UTC-offset start as an instant', () => {
    // 10:00+05:30 == 04:30Z; +60min == 05:30Z.
    expect(computeEndsAt(at('2026-09-07T10:00:00+05:30'), 60).toISOString()).toBe(
      '2026-09-07T05:30:00.000Z',
    )
  })
})
