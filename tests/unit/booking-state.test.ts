// tests/unit/booking-state.test.ts
import { describe, expect, it } from 'vitest'

import { canTransition, consumesCapacity } from '@/server/domain/booking-state'
import type { BookingStatus } from '@/generated/prisma/enums'

const ALL: BookingStatus[] = ['BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW']
const LEGAL: Array<[BookingStatus, BookingStatus]> = [
  ['BOOKED', 'CANCELLED'],
  ['BOOKED', 'ATTENDED'],
  ['BOOKED', 'NO_SHOW'],
  ['WAITLISTED', 'CANCELLED'],
  ['WAITLISTED', 'BOOKED'],
]

describe('booking state machine', () => {
  it('allows exactly the legal transitions and rejects every other', () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}->${t}`))
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(legal.has(`${from}->${to}`))
      }
    }
  })

  it('rejects the tempting illegal moves', () => {
    for (const [f, t] of [
      ['CANCELLED', 'BOOKED'],
      ['ATTENDED', 'CANCELLED'],
      ['NO_SHOW', 'BOOKED'],
      ['WAITLISTED', 'ATTENDED'],
      ['BOOKED', 'BOOKED'],
      ['CANCELLED', 'CANCELLED'],
    ] as Array<[BookingStatus, BookingStatus]>) {
      expect(canTransition(f, t)).toBe(false)
    }
  })

  it('counts only BOOKED/ATTENDED/NO_SHOW toward capacity', () => {
    expect(consumesCapacity('BOOKED')).toBe(true)
    expect(consumesCapacity('ATTENDED')).toBe(true)
    expect(consumesCapacity('NO_SHOW')).toBe(true)
    expect(consumesCapacity('WAITLISTED')).toBe(false)
    expect(consumesCapacity('CANCELLED')).toBe(false)
  })
})
