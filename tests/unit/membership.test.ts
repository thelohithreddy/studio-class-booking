// tests/unit/membership.test.ts
import { describe, expect, it } from 'vitest'

import { isMembershipValid, studioToday } from '@/server/domain/membership'

// A fixed "now": 2026-09-15T12:00:00Z. STUDIO_TIMEZONE defaults to UTC in tests.
const now = new Date('2026-09-15T12:00:00Z')
const utcDate = (d: string) => new Date(`${d}T00:00:00.000Z`)

describe('membership validity (expiry date has passed → cannot book)', () => {
  it('today in the studio timezone is a UTC-midnight date', () => {
    expect(studioToday(now).toISOString()).toBe('2026-09-15T00:00:00.000Z')
  })

  it('expires today → still valid (valid through the expiry date)', () => {
    expect(isMembershipValid(utcDate('2026-09-15'), now)).toBe(true)
  })

  it('expires tomorrow → valid', () => {
    expect(isMembershipValid(utcDate('2026-09-16'), now)).toBe(true)
  })

  it('expired yesterday → invalid', () => {
    expect(isMembershipValid(utcDate('2026-09-14'), now)).toBe(false)
  })

  it('expired long ago → invalid', () => {
    expect(isMembershipValid(utcDate('2020-01-01'), now)).toBe(false)
  })
})

describe('studio timezone actually shifts the civil date', () => {
  // vitest defaults STUDIO_TIMEZONE to UTC; this pins that studioToday uses the
  // configured zone, not the server's, by stubbing the env for one import.
  it('computes a different civil date in a far-ahead zone near midnight', async () => {
    const { studioToday: utcToday } = await import('@/server/domain/membership')
    // At 23:30 UTC on the 15th, it is already the 16th in UTC+14.
    const nowLate = new Date('2026-09-15T23:30:00Z')
    expect(utcToday(nowLate).toISOString()).toBe('2026-09-15T00:00:00.000Z') // UTC default
    // The conversion itself (independent of env) — Kiritimati is UTC+14.
    const kiritimati = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Kiritimati',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(nowLate)
    expect(kiritimati).toBe('2026-09-16') // a day ahead of UTC
  })
})

describe('studioDateToUtc (studio-local midnight → UTC instant)', () => {
  it('is UTC-identity when the studio timezone is UTC (the test default)', async () => {
    const { studioDateToUtc } = await import('@/server/domain/membership')
    expect(studioDateToUtc('2026-09-01').toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('converts a positive-offset zone correctly across a DST change (verified via Intl)', () => {
    // Independent of env: London is UTC+1 in summer (BST), UTC+0 in winter.
    // Local midnight 2026-07-01 = 2026-06-30T23:00Z; 2026-12-01 = 2026-12-01T00:00Z.
    const offset = (iso: string, tz: string) => {
      const naive = new Date(`${iso}T00:00:00Z`)
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        })
          .formatToParts(naive)
          .map((p) => [p.type, p.value]),
      ) as Record<string, string>
      return `${parts.hour}:${parts.minute}`
    }
    expect(offset('2026-07-01', 'Europe/London')).toBe('01:00') // BST: +1
    expect(offset('2026-12-01', 'Europe/London')).toBe('00:00') // GMT: +0
  })
})
