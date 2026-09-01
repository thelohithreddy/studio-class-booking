// app/api/sessions/[id]/attendance/route.ts
import { db } from '@/lib/db'
import { handleRoute, type RouteContext } from '@/lib/api/errors'
import { requireCapability } from '@/server/authorization/guards'
import { exportSessionAttendanceCsv } from '@/server/domain/attendance'

/**
 * GET /api/sessions/[id]/attendance — CSV export of a session's attendance
 * (Goal 7). STAFF only (attendance:export, decisions.md #17): the capability
 * guard runs FIRST, so a non-staff caller (an instructor, even one who teaches
 * the session) gets 403 before the session is resolved or any data is read —
 * the endpoint can never become a data-exfiltration bypass. There are no query
 * parameters: the export is always "every booking of this session", which
 * removes the filter-widening / status / date / SQLi-via-filter surfaces
 * entirely. Identity/role come only from the SessionUser the guard returns.
 *
 * The body is a raw text/csv Response (not JSON) with a UTF-8 BOM so Excel
 * decodes Unicode names correctly; the filename is built only from a
 * server-derived date and the validated session uuid, so no user-controlled
 * bytes reach the Content-Disposition header. An error (401/403/404/413) still
 * flows through handleRoute's JSON error taxonomy.
 */
export const GET = handleRoute<RouteContext<'id'>>(async (req, ctx) => {
  await requireCapability(req, 'attendance:export')
  const { id } = await ctx.params
  const { filename, body } = await exportSessionAttendanceCsv(db(), id)

  return new Response(`\uFEFF${body}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      // The body carries member-supplied text; forbid MIME sniffing so a browser
      // can never reinterpret it as HTML/script (it is already an attachment).
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
