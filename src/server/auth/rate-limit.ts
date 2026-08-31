// src/server/auth/rate-limit.ts

/**
 * Fixed-window failure counter for login abuse.
 *
 * Deliberately in-memory and per-process: the deploy target is a single
 * instance, Argon2 already makes each attempt expensive, and a distributed
 * limiter (DB/Redis) is the documented escalation path, not take-home scope.
 * Sessions themselves live in Postgres — only these counters are local.
 *
 * The store is bounded: entries expire with their window, and an LRU-ish cap
 * stops an attacker from growing the map without bound using made-up keys.
 */
interface Bucket {
  count: number
  windowStartedAt: number
}

export interface RateLimiter {
  /** Returns true when the key is over the limit right now. */
  isLimited(key: string): boolean
  /** Records a failure against the key. */
  recordFailure(key: string): void
  /** Clears the key (successful login). */
  reset(key: string): void
}

export function createRateLimiter(
  { limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number },
  now: () => number = Date.now,
): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function liveBucket(key: string): Bucket | undefined {
    const bucket = buckets.get(key)
    if (!bucket) return undefined
    if (now() - bucket.windowStartedAt >= windowMs) {
      buckets.delete(key)
      return undefined
    }
    return bucket
  }

  return {
    isLimited(key) {
      const bucket = liveBucket(key)
      return bucket !== undefined && bucket.count >= limit
    },

    recordFailure(key) {
      const bucket = liveBucket(key)
      if (bucket) {
        bucket.count += 1
        return
      }
      if (buckets.size >= maxKeys) {
        // Bounded memory beats perfect fairness — but never evict a bucket
        // that is currently AT the limit, or an attacker could flood junk
        // keys to flush a victim bucket and reset its counter. Evict the
        // oldest unlimited bucket instead (falling back to the oldest of all
        // if every bucket is limited, which only an attacker can arrange).
        let evicted = false
        for (const [candidate, candidateBucket] of buckets) {
          if (
            candidateBucket.count < limit ||
            now() - candidateBucket.windowStartedAt >= windowMs
          ) {
            buckets.delete(candidate)
            evicted = true
            break
          }
        }
        if (!evicted) {
          const oldest = buckets.keys().next().value
          if (oldest !== undefined) buckets.delete(oldest)
        }
      }
      buckets.set(key, { count: 1, windowStartedAt: now() })
    },

    reset(key) {
      buckets.delete(key)
    },
  }
}
