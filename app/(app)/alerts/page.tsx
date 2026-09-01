'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useAlerts } from '../alerts-provider'
import { api, Button, Notice } from '../ui'

/** Urgency in TEXT (never colour alone), from the server-computed daysRemaining. */
function urgencyLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days)
    return `Expired ${n} day${n === 1 ? '' : 's'} ago`
  }
  if (days === 0) return 'Expires today'
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}

export default function AlertsPage() {
  const alertsCtx = useAlerts()
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({})
  const [dismissError, setDismissError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  // No provider means a non-staff visitor (an instructor): the alerts UI is
  // staff-only, so send them to their own home. The data is protected server-side
  // by the API regardless; this is UX only.
  useEffect(() => {
    if (!alertsCtx) router.replace('/sessions')
  }, [alertsCtx, router])
  if (!alertsCtx) return null

  const { data, loading, error, reload } = alertsCtx

  async function dismiss(memberId: string, name: string) {
    setDismissError(null)
    setDismissing((d) => ({ ...d, [memberId]: true }))
    try {
      // Server-authoritative: the dismissal records the member's CURRENT expiry.
      await api(`/api/members/${memberId}/alert-dismiss`, { method: 'POST', body: '{}' })
      setStatus(`Membership alert for ${name} dismissed.`) // announced via aria-live
      headingRef.current?.focus() // move focus off the Dismiss button before its row unmounts
      reload() // only remove the alert (and update the badge) after the server confirms
    } catch (e) {
      setDismissError((e as Error).message) // keep the alert visible; never optimistically hide
    } finally {
      setDismissing((d) => ({ ...d, [memberId]: false }))
    }
  }

  if (loading && !data) {
    return (
      <p role="status" className="text-sm text-slate-500">
        Loading…
      </p>
    )
  }
  // Only a first-load failure (no data yet) replaces the view; a later reload
  // failure keeps the last list and surfaces the error as a banner below.
  if (error && !data) return <Notice error={error} />

  const alerts = data?.alerts ?? []

  return (
    <section aria-labelledby="alerts-h" className="flex flex-col gap-4">
      <h1 id="alerts-h" ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
        Membership alerts
      </h1>
      <p className="text-sm text-slate-500">
        Members whose membership has expired or expires within seven days.
      </p>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? <Notice error={error} /> : null}
      <Notice error={dismissError} />

      {alerts.length === 0 ? (
        <p className="text-sm text-slate-500">No membership alerts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => (
            <li
              key={a.memberId}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 px-4 py-3 dark:border-slate-800"
            >
              <div className="text-sm">
                <strong>{a.name}</strong>
                <span className="text-slate-500">
                  {' · '}
                  {a.membershipExpiresOn}
                  {' · '}
                  {urgencyLabel(a.daysRemaining)}
                </span>
              </div>
              <Button
                onClick={() => dismiss(a.memberId, a.name)}
                disabled={dismissing[a.memberId]}
                aria-label={`Dismiss membership alert for ${a.name}`}
              >
                {dismissing[a.memberId] ? 'Dismissing…' : 'Dismiss'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
