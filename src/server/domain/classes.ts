// src/server/domain/classes.ts
import type { Db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { parseIdOr404 } from '@/server/domain/ids'
import type { CreateClassInput, UpdateClassInput } from '@/lib/schemas/domain'

/** Fields returned for a class — every scalar; nothing is sensitive here. */
const CLASS_SELECT = {
  id: true,
  title: true,
  description: true,
  discipline: true,
  defaultDurationMinutes: true,
  defaultCapacity: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export function createClass(db: Db, input: CreateClassInput) {
  return db.class.create({ data: input, select: CLASS_SELECT })
}

export async function updateClass(db: Db, id: string, input: UpdateClassInput) {
  const validId = parseIdOr404(id, 'Class not found.')
  await requireClass(db, validId)
  return db.class.update({ where: { id: validId }, data: input, select: CLASS_SELECT })
}

/** Archive is idempotent: archiving an already-archived class is a no-op. */
export async function archiveClass(db: Db, id: string) {
  const validId = parseIdOr404(id, 'Class not found.')
  const existing = await requireClass(db, validId)
  if (existing.archivedAt) return existing
  return db.class.update({
    where: { id: validId },
    data: { archivedAt: new Date() },
    select: CLASS_SELECT,
  })
}

/** Restore is idempotent: restoring an active class is a no-op. */
export async function restoreClass(db: Db, id: string) {
  const validId = parseIdOr404(id, 'Class not found.')
  const existing = await requireClass(db, validId)
  if (!existing.archivedAt) return existing
  return db.class.update({
    where: { id: validId },
    data: { archivedAt: null },
    select: CLASS_SELECT,
  })
}

export async function getClass(db: Db, id: string) {
  const klass = await db.class.findUnique({
    where: { id: parseIdOr404(id, 'Class not found.') },
    select: { ...CLASS_SELECT, _count: { select: { sessions: true } } },
  })
  if (!klass) throw new ApiError(404, 'not_found', 'Class not found.')
  return klass
}

export async function listClasses(
  db: Db,
  {
    page,
    pageSize,
    q,
    includeArchived,
  }: { page: number; pageSize: number; q?: string; includeArchived: boolean },
) {
  const where = {
    ...(includeArchived ? {} : { archivedAt: null }),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' as const } },
            { discipline: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }
  const [classes, total] = await Promise.all([
    db.class.findMany({
      where,
      select: CLASS_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.class.count({ where }),
  ])
  return { classes, total, page, pageSize }
}

/** Loads a class or throws the shared 404. */
async function requireClass(db: Db, id: string) {
  const klass = await db.class.findUnique({
    where: { id: parseIdOr404(id, 'Class not found.') },
    select: CLASS_SELECT,
  })
  if (!klass) throw new ApiError(404, 'not_found', 'Class not found.')
  return klass
}
