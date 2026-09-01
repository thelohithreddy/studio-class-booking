// tests/unit/studio-time.test.ts
//
// The wall-clock → UTC resolver that recurring generation rides on. The
// property that matters: a weekly pattern at a fixed studio-local time stays at
// that local time across a DST switch (the UTC instant moves, the wall clock
// does not). Also pins the transition-hour policy for nonexistent/ambiguous
// times so a pathological start time is deterministic rather than arbitrary.
import { describe, expect, it } from 'vitest'

import { zonedWallClockToUtc } from '@/server/domain/membership'

const LONDON = 'Europe/London'
const NY = 'America/New_York'

/** The wall clock (HH:MM) the given instant reads at in `tz` — for round-trips. */
function localHHMM(instant: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return `${p.hour}:${p.minute}`
}

describe('zonedWallClockToUtc — normal times', () => {
  it('is identity in UTC', () => {
    expect(zonedWallClockToUtc('2026-06-15', '18:00', 'UTC').toISOString()).toBe(
      '2026-06-15T18:00:00.000Z',
    )
  })

  it('London summer (BST, +1): 18:00 local → 17:00Z', () => {
    expect(zonedWallClockToUtc('2026-07-14', '18:00', LONDON).toISOString()).toBe(
      '2026-07-14T17:00:00.000Z',
    )
  })

  it('London winter (GMT, +0): 18:00 local → 18:00Z', () => {
    expect(zonedWallClockToUtc('2026-12-15', '18:00', LONDON).toISOString()).toBe(
      '2026-12-15T18:00:00.000Z',
    )
  })
})

describe('zonedWallClockToUtc — DST invariance (the recurring-generation property)', () => {
  // A weekly 18:00 Tuesday across the autumn switch (Sun 2026-10-25, 02:00 BST →
  // 01:00 GMT): the wall clock holds at 18:00, the UTC instant steps by an hour.
  it('18:00 stays 18:00 local across the autumn fall-back', () => {
    const before = zonedWallClockToUtc('2026-10-20', '18:00', LONDON) // BST
    const after = zonedWallClockToUtc('2026-10-27', '18:00', LONDON) // GMT
    expect(before.toISOString()).toBe('2026-10-20T17:00:00.000Z')
    expect(after.toISOString()).toBe('2026-10-27T18:00:00.000Z')
    expect(localHHMM(before, LONDON)).toBe('18:00')
    expect(localHHMM(after, LONDON)).toBe('18:00')
  })

  // Across the spring switch (Sun 2026-03-29, 01:00 GMT → 02:00 BST).
  it('18:00 stays 18:00 local across the spring forward', () => {
    const before = zonedWallClockToUtc('2026-03-24', '18:00', LONDON) // GMT
    const after = zonedWallClockToUtc('2026-03-31', '18:00', LONDON) // BST
    expect(before.toISOString()).toBe('2026-03-24T18:00:00.000Z')
    expect(after.toISOString()).toBe('2026-03-31T17:00:00.000Z')
    expect(localHHMM(before, LONDON)).toBe('18:00')
    expect(localHHMM(after, LONDON)).toBe('18:00')
  })

  it('holds in a negative-offset zone too (New York, autumn)', () => {
    // NY fall-back Sun 2026-11-01. 09:00 local: EDT(-4) → 13:00Z, EST(-5) → 14:00Z.
    const before = zonedWallClockToUtc('2026-10-27', '09:00', NY) // EDT
    const after = zonedWallClockToUtc('2026-11-03', '09:00', NY) // EST
    expect(before.toISOString()).toBe('2026-10-27T13:00:00.000Z')
    expect(after.toISOString()).toBe('2026-11-03T14:00:00.000Z')
    expect(localHHMM(before, NY)).toBe('09:00')
    expect(localHHMM(after, NY)).toBe('09:00')
  })
})

describe('zonedWallClockToUtc — transition-adjacent times still resolve exactly', () => {
  it('New York 01:30 (before the spring gap, EST) → 06:30Z', () => {
    const u = zonedWallClockToUtc('2026-03-08', '01:30', NY)
    expect(u.toISOString()).toBe('2026-03-08T06:30:00.000Z')
    expect(localHHMM(u, NY)).toBe('01:30')
  })

  it('New York 03:30 (after the spring gap, EDT) → 07:30Z', () => {
    const u = zonedWallClockToUtc('2026-03-08', '03:30', NY)
    expect(u.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(localHHMM(u, NY)).toBe('03:30')
  })
})

describe('zonedWallClockToUtc — pathological transition-hour policy', () => {
  it('a NONEXISTENT spring-forward wall time resolves FORWARD', () => {
    // London 2026-03-29: 01:00 GMT jumps to 02:00 BST, so 01:30 never occurs.
    // Policy: push forward → 02:30 BST = 01:30Z.
    const u = zonedWallClockToUtc('2026-03-29', '01:30', LONDON)
    expect(u.toISOString()).toBe('2026-03-29T01:30:00.000Z')
    expect(localHHMM(u, LONDON)).toBe('02:30')
  })

  it('New York nonexistent 02:30 resolves forward to 03:30 EDT', () => {
    const u = zonedWallClockToUtc('2026-03-08', '02:30', NY)
    expect(localHHMM(u, NY)).toBe('03:30')
    expect(u.toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })

  it('an AMBIGUOUS fall-back wall time resolves to the standard-time occurrence (positive-offset zone)', () => {
    // London 2026-10-25: 02:00 BST falls back to 01:00 GMT, so 01:30 occurs twice
    // (00:30Z in BST, then 01:30Z in GMT). Policy: the later, GMT (standard) occurrence.
    const u = zonedWallClockToUtc('2026-10-25', '01:30', LONDON)
    expect(u.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    expect(localHHMM(u, LONDON)).toBe('01:30')
  })

  it('...and to standard time in a NEGATIVE-offset zone too (sign-independent)', () => {
    // New York 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:30 occurs twice
    // (05:30Z in EDT, then 06:30Z in EST). The later, EST (standard) occurrence — the
    // resolver must NOT return the earlier EDT reading just because the offset is negative.
    const u = zonedWallClockToUtc('2026-11-01', '01:30', NY)
    expect(u.toISOString()).toBe('2026-11-01T06:30:00.000Z')
    expect(localHHMM(u, NY)).toBe('01:30')
  })
})
