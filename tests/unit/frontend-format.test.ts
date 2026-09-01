// tests/unit/frontend-format.test.ts
//
// The client-side presentation helpers. The load-bearing one is calendar-date
// extraction: it must never drift a day regardless of the viewer's timezone.
import { describe, expect, it } from 'vitest'

import {
  formatDaysRemaining,
  formatDuration,
  initials,
  pluralize,
  toDateInputValue,
} from '@app/_lib/format'

describe('toDateInputValue (UTC calendar date — timezone-stable)', () => {
  it('extracts YYYY-MM-DD from a UTC-midnight instant without drifting', () => {
    // toISOString is always UTC, so the calendar day is preserved everywhere.
    expect(toDateInputValue('2026-09-15T00:00:00.000Z')).toBe('2026-09-15')
    expect(toDateInputValue('2026-01-01T00:00:00.000Z')).toBe('2026-01-01')
  })
  it('passes a bare YYYY-MM-DD through unchanged', () => {
    expect(toDateInputValue('2026-02-28')).toBe('2026-02-28')
  })
})

describe('formatDuration', () => {
  it('formats minutes into compact h/m', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(75)).toBe('1h 15m')
  })
})

describe('formatDaysRemaining', () => {
  it('describes the expiry relative to today', () => {
    expect(formatDaysRemaining(0)).toBe('expires today')
    expect(formatDaysRemaining(1)).toBe('expires tomorrow')
    expect(formatDaysRemaining(5)).toBe('expires in 5 days')
    expect(formatDaysRemaining(-1)).toBe('expired yesterday')
    expect(formatDaysRemaining(-4)).toBe('expired 4 days ago')
  })
})

describe('initials', () => {
  it('derives up to two initials from a name', () => {
    expect(initials('Jordan Lee')).toBe('JL')
    expect(initials('Cher')).toBe('CH')
    expect(initials('mary jane watson')).toBe('MW')
  })
  it('falls back to ? for empty/whitespace names', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('pluralize', () => {
  it('pluralizes based on count', () => {
    expect(pluralize(1, 'spot')).toBe('1 spot')
    expect(pluralize(0, 'spot')).toBe('0 spots')
    expect(pluralize(3, 'spot')).toBe('3 spots')
    expect(pluralize(2, 'class', 'classes')).toBe('2 classes')
  })
})
