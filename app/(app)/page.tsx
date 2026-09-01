'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { DashboardDto } from '@/lib/dashboard-dto'

import { DashboardView } from './dashboard-view'
import { Button, Notice } from './ui'

/**
 * The studio operational dashboard (Goal 8) is the STAFF landing view. It is a
 * thin CLIENT view over the server-authorized GET /api/dashboard — the same
 * client-page + API pattern every other page uses, which (unlike a Server
 * Component that redirects at build) Next renders per request rather than
 * prerendering a cached snapshot. The AUTHORIZATION is enforced server-side by
 * the route's requireCapability('dashboard:studio').
 *
 * Error handling distinguishes the authorization cases from a real failure by
 * HTTP status: 403 (an instructor — no studio-wide data ever reaches them) sends
 * them to their scoped home; 401 (session gone) to /login; anything else renders
 * a visible, announced error with a retry rather than silently bouncing an
 * authorized staff user off their own dashboard.
 */
type State =
  | { status: 'loading' }
  | { status: 'ok'; data: DashboardDto }
  | { status: 'error'; message: string }

export default function DashboardHome() {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    fetch('/api/dashboard', { headers: { 'content-type': 'application/json' } })
      .then(async (res) => {
        if (!active) return
        if (res.status === 401) return router.replace('/login')
        if (res.status === 403) return router.replace('/sessions')
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string }
          } | null
          setState({
            status: 'error',
            message: body?.error?.message ?? `Could not load the dashboard (${res.status}).`,
          })
          return
        }
        setState({ status: 'ok', data: (await res.json()) as DashboardDto })
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Could not load the dashboard.' })
      })
    return () => {
      active = false
    }
  }, [router, nonce])

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-slate-500">
        Loading…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice error={state.message} />
        <Button
          onClick={() => {
            setState({ status: 'loading' })
            setNonce((n) => n + 1)
          }}
        >
          Retry
        </Button>
      </div>
    )
  }
  return <DashboardView data={state.data} />
}
