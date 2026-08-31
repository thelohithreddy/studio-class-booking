// tests/unit/password.test.ts
import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from '@/server/auth/password'

describe('password service', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(hash, 'correct horse battery stapl')).resolves.toBe(false)
  })

  it('produces argon2id hashes with the pinned parameters', async () => {
    const hash = await hashPassword('x')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(hash).toContain('m=19456,t=2,p=1')
  })

  it('salts: hashing the same password twice differs', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')])
    expect(a).not.toBe(b)
    await expect(verifyPassword(a, 'same')).resolves.toBe(true)
    await expect(verifyPassword(b, 'same')).resolves.toBe(true)
  })

  it('handles long and unicode passwords without truncation surprises', async () => {
    const long = 'ü🔐'.repeat(60) // > 72 bytes — the classic bcrypt truncation zone
    const hash = await hashPassword(long)
    await expect(verifyPassword(hash, long)).resolves.toBe(true)
    await expect(verifyPassword(hash, long.slice(0, -1))).resolves.toBe(false)
  })

  it('treats a malformed stored hash as a failed verification, not an error', async () => {
    await expect(verifyPassword('not-a-phc-hash', 'anything')).resolves.toBe(false)
  })
})
