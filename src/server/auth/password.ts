// src/server/auth/password.ts
import { hash, verify } from '@node-rs/argon2'

/**
 * Password hashing boundary. Argon2id with OWASP's recommended minimums
 * (19 MiB memory, 2 iterations, 1 lane): memory-hardness is what bcrypt
 * lacks, and the parameters are pinned here so a future "why these numbers"
 * question has one answer in one place.
 *
 * Nothing else in the codebase may import @node-rs/argon2 directly.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // KiB — 19 MiB
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS)
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  // verify() throws on malformed hashes; a stored-garbage hash must read as
  // "wrong password", not as a 500.
  return verify(hashed, plain, ARGON2_OPTIONS).catch(() => false)
}
