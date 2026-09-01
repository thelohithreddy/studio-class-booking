// src/server/domain/search.ts

/**
 * Escapes a user search term so LIKE/ILIKE metacharacters are matched
 * LITERALLY. A search box is a substring search, not a pattern language: a
 * member searching for "50%" wants the member literally named "50%", not
 * "everything". Prisma parameterizes the value (so this is never an injection
 * concern), but Prisma's `contains` does not escape `%`/`_`, so we prefix the
 * default LIKE escape character (`\`) before `\`, `%` and `_`. Postgres ILIKE
 * then treats them as literal characters (verified end-to-end).
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}
