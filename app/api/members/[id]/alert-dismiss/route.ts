// app/api/members/[id]/alert-dismiss/route.ts
import { z } from 'zod'

import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { dismissMembershipAlert } from '@/server/domain/alerts'

// The dismissal takes NO body fields: the dismissed expiry value comes from the
// member's current record (server-authoritative) and the actor from the
// SessionUser — never the client. The .strict() empty schema rejects any
// smuggled field (membership_expires_on / dismissed_by_id / role) as a 400.
const dismissSchema = z.object({}).strict()

/**
 * POST /api/members/[id]/alert-dismiss — dismiss a member's current membership
 * expiry alert (Goal 10). STAFF only (alert:dismiss): an instructor 403s, unauth
 * 401s. Idempotent and concurrency-safe (a repeat or concurrent dismiss leaves
 * exactly one row). A missing/malformed member id is a 404. Returns 204.
 */
export const POST = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  const actor = await requireCapability(req, 'alert:dismiss')
  const { id } = await ctx.params
  dismissSchema.parse(await req.json().catch(() => ({})))
  await dismissMembershipAlert(db(), actor, id)
  return new Response(null, { status: 204 })
})
