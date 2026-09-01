'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import type { MembershipAlertsDto } from '@/lib/alerts-dto'

/**
 * Client-side source of truth for the membership-alert count badge (in the nav)
 * and the /alerts list — one fetch of GET /api/members/alerts, shared, so a
 * dismiss on the list reloads both together. Rendered by the (app) layout for
 * STAFF ONLY, so an instructor never mounts it or fetches the staff-only route.
 * Server state is authoritative (a dismiss re-fetches rather than optimistically
 * mutating); multi-tab staleness is accepted (no realtime infrastructure).
 */
interface AlertsState {
  data: MembershipAlertsDto | null
  loading: boolean
  error: string | null
  reload: () => void
}

const AlertsContext = createContext<AlertsState | null>(null)

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MembershipAlertsDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => {
    setLoading(true)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/members/alerts', { headers: { 'content-type': 'application/json' } })
      .then(async (res) => {
        if (!active) return
        if (!res.ok) {
          setError(`Could not load membership alerts (${res.status}).`)
          return
        }
        setData((await res.json()) as MembershipAlertsDto)
        setError(null)
      })
      .catch(() => {
        if (active) setError('Could not load membership alerts.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [nonce])

  return (
    <AlertsContext.Provider value={{ data, loading, error, reload }}>
      {children}
    </AlertsContext.Provider>
  )
}

/** Returns the alerts state, or null when there is no AlertsProvider (the layout
 * mounts it for STAFF only — a non-staff consumer, e.g. an instructor on /alerts,
 * gets null and can redirect rather than crash). */
export function useAlerts(): AlertsState | null {
  return useContext(AlertsContext)
}

/** The nav "Alerts" link with a live count badge. The number is decorative; the
 * count is also spoken to assistive tech, and urgency is never conveyed by
 * colour alone. */
export function AlertsBadge() {
  const count = useAlerts()?.data?.count ?? 0
  return (
    <Link
      href="/alerts"
      className="flex items-center gap-1 text-slate-600 hover:underline dark:text-slate-400"
    >
      Alerts
      {count > 0 && (
        <span
          aria-hidden="true"
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
        >
          {count}
        </span>
      )}
      <span className="sr-only">
        {count} membership {count === 1 ? 'alert' : 'alerts'}
      </span>
    </Link>
  )
}
