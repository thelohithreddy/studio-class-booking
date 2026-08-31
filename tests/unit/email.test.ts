import { describe, expect, it } from 'vitest'

import { normalizeEmail } from '@/lib/email'

describe('normalizeEmail', () => {
  it('trims and lowercases — the single normalization every writer and reader shares', () => {
    expect(normalizeEmail('  Casey@Studio.TEST ')).toBe('casey@studio.test')
    expect(normalizeEmail('already@lower.test')).toBe('already@lower.test')
  })
})
