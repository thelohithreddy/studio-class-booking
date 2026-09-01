// tests/unit/search.test.ts
import { describe, expect, it } from 'vitest'

import { escapeLike } from '@/server/domain/search'

describe('escapeLike', () => {
  it('escapes LIKE metacharacters so they match literally', () => {
    expect(escapeLike('50%')).toBe('50\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('back\\slash')).toBe('back\\\\slash')
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Ada Lovelace')).toBe('Ada Lovelace')
    expect(escapeLike('ada@studio.test')).toBe('ada@studio.test')
    expect(escapeLike('')).toBe('')
  })
})
