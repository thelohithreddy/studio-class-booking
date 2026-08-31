// src/lib/email.ts

/**
 * The one email normalization. The database's lower(email) unique indexes
 * enforce uniqueness case-insensitively, but they do not change equality
 * semantics on reads — so correctness of every email lookup depends on the
 * invariant that EVERY writer and every reader normalizes identically,
 * through this function. (Login does; so must any future user/member
 * creation path and the seed.)
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
