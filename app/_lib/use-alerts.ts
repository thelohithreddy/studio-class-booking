// app/_lib/use-alerts.ts
'use client'

import { qk, useApiQuery } from './query'
import type { MembershipAlertsResponse } from './types'

/**
 * Staff-only membership alerts, shared (one cache entry) by the nav count badge
 * and the /alerts page — so dismissing on the page updates the badge too. Only
 * enable it for staff; an instructor never fetches the staff-only route.
 */
export function useAlerts(enabled: boolean) {
  return useApiQuery<MembershipAlertsResponse>(qk.alerts, '/api/members/alerts', {
    enabled,
    staleTime: 30_000,
  })
}
