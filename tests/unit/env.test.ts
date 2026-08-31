import { describe, expect, it } from 'vitest'

import { parseEnv } from '@/lib/env'

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://studio:studio@localhost:5432/studio_dev?schema=public',
} satisfies Record<string, string>

describe('parseEnv', () => {
  it('accepts a well-formed environment', () => {
    expect(parseEnv(validEnv)).toMatchObject({
      NODE_ENV: 'test',
      DATABASE_URL: validEnv.DATABASE_URL,
    })
  })

  it('defaults NODE_ENV to development when unset', () => {
    const { NODE_ENV: _omitted, ...withoutNodeEnv } = validEnv
    expect(parseEnv(withoutNodeEnv).NODE_ENV).toBe('development')
  })

  it('rejects a missing DATABASE_URL with a message naming the variable', () => {
    const { DATABASE_URL: _omitted, ...withoutUrl } = validEnv
    expect(() => parseEnv(withoutUrl)).toThrowError(/DATABASE_URL/)
  })

  it('rejects a connection string that is not postgres', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/studio' })).toThrowError(
      /postgres/,
    )
  })
})
