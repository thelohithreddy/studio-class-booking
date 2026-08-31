// tests/unit/rate-limit.test.ts
import { describe, expect, it } from 'vitest'

import { createRateLimiter } from '@/server/auth/rate-limit'

function limiterWithClock(startAt = 0) {
  let time = startAt
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, maxKeys: 4 }, () => time)
  return { limiter, advance: (ms: number) => (time += ms) }
}

describe('rate limiter', () => {
  it('limits after the configured number of failures', () => {
    const { limiter } = limiterWithClock()
    expect(limiter.isLimited('k')).toBe(false)
    limiter.recordFailure('k')
    limiter.recordFailure('k')
    expect(limiter.isLimited('k')).toBe(false)
    limiter.recordFailure('k')
    expect(limiter.isLimited('k')).toBe(true)
  })

  it('forgets failures once the window passes', () => {
    const { limiter, advance } = limiterWithClock()
    for (let i = 0; i < 3; i++) limiter.recordFailure('k')
    expect(limiter.isLimited('k')).toBe(true)
    advance(1001)
    expect(limiter.isLimited('k')).toBe(false)
  })

  it('isolates keys', () => {
    const { limiter } = limiterWithClock()
    for (let i = 0; i < 3; i++) limiter.recordFailure('a')
    expect(limiter.isLimited('a')).toBe(true)
    expect(limiter.isLimited('b')).toBe(false)
  })

  it('reset clears a key (successful login)', () => {
    const { limiter } = limiterWithClock()
    for (let i = 0; i < 3; i++) limiter.recordFailure('k')
    limiter.reset('k')
    expect(limiter.isLimited('k')).toBe(false)
  })

  it('caps the key store: an unlimited bucket is evicted under key-flood', () => {
    const { limiter } = limiterWithClock()
    limiter.recordFailure('x')
    limiter.recordFailure('x') // 2 of 3 — below the limit, so evictable
    for (let i = 0; i < 10; i++) limiter.recordFailure(`junk-${i}`) // maxKeys is 4
    limiter.recordFailure('x') // must be a FRESH bucket if eviction happened
    // Without the cap this would be x's third failure → limited. With it, x
    // was evicted by the flood and starts over — the bound is observable.
    expect(limiter.isLimited('x')).toBe(false)
  })

  it('a key-flood cannot flush a limited bucket and reset its counter', () => {
    const { limiter } = limiterWithClock()
    for (let i = 0; i < 3; i++) limiter.recordFailure('victim')
    expect(limiter.isLimited('victim')).toBe(true)
    // Flood far past maxKeys (4) with junk keys — the victim bucket, being at
    // the limit, must survive every eviction round.
    for (let i = 0; i < 50; i++) limiter.recordFailure(`junk-${i}`)
    expect(limiter.isLimited('victim')).toBe(true)
  })
})
