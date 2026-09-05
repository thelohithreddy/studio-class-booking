import { z } from 'zod'

/**
 * Environment validation.
 *
 * Every environment variable the server needs is declared here and parsed
 * once, at first import. A missing or malformed value should stop the process
 * at boot with a readable message, not surface as `undefined` three layers
 * down inside a request handler.
 *
 * Variables are added to this schema in the phase that first consumes them —
 * see .env.example for the full inventory including the not-yet-used ones.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — copy .env.example to .env')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),

  // The IANA timezone the studio operates in. Every "today" the booking and
  // (later) alert logic computes derives from it, so a membership expiring
  // "today" is judged in the studio's day, not the server's. Validated as a
  // real IANA zone; defaults to UTC.
  STUDIO_TIMEZONE: z
    .string()
    .default('UTC')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz })
        return true
      } catch {
        return false
      }
    }, 'STUDIO_TIMEZONE must be a valid IANA timezone (e.g. Europe/London)'),

  // Opt-in, deployment-scoped flag for the one-click demo entry (POST
  // /api/auth/demo). Off unless set to exactly "true": a real studio deployment
  // leaves it unset and the demo endpoint 404s. Only ever mints a session for a
  // fixed, pre-seeded demo account (see src/server/auth/demo.ts) — never an
  // arbitrary user, never account creation.
  ALLOW_DEMO_LOGIN: z.enum(['true', 'false']).optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * Parses a set of raw values against the schema.
 *
 * Exported separately from the singleton below so tests can exercise the
 * validation rules without mutating `process.env`.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new Error(`Invalid environment configuration:\n${problems}`)
  }

  return result.data
}

let cached: Env | undefined

/**
 * The validated environment.
 *
 * A function rather than a module-level constant so that importing anything
 * from this file — in a test, in a build step — does not itself require a
 * fully configured environment.
 */
export function env(): Env {
  cached ??= parseEnv(process.env)
  return cached
}
