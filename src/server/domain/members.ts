// src/server/domain/members.ts
import type { Db } from '@/lib/db'
import { ApiError } from '@/lib/api/errors'
import { withDbErrors } from '@/lib/api/db-errors'
import { parseIdOr404 } from '@/server/domain/ids'
import type { CreateMemberInput, UpdateMemberInput } from '@/lib/schemas/domain'

/**
 * Members are not users — no password, no role, no login. The select reflects
 * that: only the fields the studio tracks.
 */
const MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  membershipExpiresOn: true,
  createdAt: true,
  updatedAt: true,
} as const

/** A YYYY-MM-DD string → a UTC-midnight Date (@db.Date truncates on the UTC day). */
function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`)
}

export function createMember(db: Db, input: CreateMemberInput) {
  return withDbErrors(
    () =>
      db.member.create({
        data: {
          name: input.name,
          email: input.email,
          membershipExpiresOn: toUtcDate(input.membershipExpiresOn),
        },
        select: MEMBER_SELECT,
      }),
    { conflict: 'A member with that email already exists.' },
  )
}

export async function updateMember(db: Db, id: string, input: UpdateMemberInput) {
  const validId = parseIdOr404(id, 'Member not found.')
  await requireMember(db, validId)
  return withDbErrors(
    () =>
      db.member.update({
        where: { id: validId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.membershipExpiresOn !== undefined
            ? { membershipExpiresOn: toUtcDate(input.membershipExpiresOn) }
            : {}),
        },
        select: MEMBER_SELECT,
      }),
    { conflict: 'A member with that email already exists.' },
  )
}

export async function getMember(db: Db, id: string) {
  const member = await db.member.findUnique({
    where: { id: parseIdOr404(id, 'Member not found.') },
    select: MEMBER_SELECT,
  })
  if (!member) throw new ApiError(404, 'not_found', 'Member not found.')
  return member
}

export async function listMembers(
  db: Db,
  { page, pageSize, q }: { page: number; pageSize: number; q?: string },
) {
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}
  const [members, total] = await Promise.all([
    db.member.findMany({
      where,
      select: MEMBER_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.member.count({ where }),
  ])
  return { members, total, page, pageSize }
}

async function requireMember(db: Db, id: string) {
  const member = await db.member.findUnique({
    where: { id: parseIdOr404(id, 'Member not found.') },
    select: { id: true },
  })
  if (!member) throw new ApiError(404, 'not_found', 'Member not found.')
  return member
}
