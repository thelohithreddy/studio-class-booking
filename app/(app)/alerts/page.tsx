'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation } from '@app/_lib/query'
import { useAlerts } from '@app/_lib/use-alerts'
import { formatDaysRemaining, formatMembershipDate } from '@app/_lib/format'
import { membershipFromDays } from '@app/_lib/status'
import type { MembershipAlert } from '@app/_lib/types'
import {
  AsyncBoundary,
  Avatar,
  Button,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  useToast,
} from '@app/_components/ui'
import { IconAlerts } from '@app/_components/icons'
import { useIsStaff } from '../_shell/user-context'

export default function AlertsPage() {
  const staff = useIsStaff()
  const router = useRouter()
  useEffect(() => {
    if (!staff) router.replace('/sessions')
  }, [staff, router])

  const alerts = useAlerts(staff)

  if (!staff) return null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Membership alerts"
        description="Members whose membership has expired or expires within the next seven days. Lapsed members can’t make new bookings."
      />

      <AsyncBoundary
        query={alerts}
        skeleton={
          <Card className="p-4">
            <SkeletonRows rows={4} />
          </Card>
        }
        isEmpty={(d) => d.alerts.length === 0}
        empty={
          <Card>
            <EmptyState
              icon={<IconAlerts className="size-5" />}
              title="No membership alerts"
              description="Every member’s membership is current. Members expiring within seven days will appear here so you can follow up."
            />
          </Card>
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <Callout tone="neutral">
              Dismissing an alert hides it until the member’s expiry date changes. If you extend a
              membership and it later falls within seven days again, the alert returns.
            </Callout>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {data.alerts.map((alert) => (
                  <AlertRow key={`${alert.memberId}-${alert.membershipExpiresOn}`} alert={alert} />
                ))}
              </ul>
            </Card>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}

function AlertRow({ alert }: { alert: MembershipAlert }) {
  const toast = useToast()
  const meta = membershipFromDays(alert.daysRemaining)

  const dismiss = useApiMutation(
    () => apiSend(`/api/members/${alert.memberId}/alert-dismiss`, 'POST', {}),
    {
      invalidate: [qk.alerts],
      onSuccess: () => toast.success(`Dismissed alert for ${alert.name}`),
      onError: (e) => toast.error('Could not dismiss alert', e.message),
    },
  )

  return (
    <li className="flex items-center gap-3 p-4">
      <Avatar name={alert.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-fg">{alert.name}</p>
          <StatusBadge meta={meta} />
        </div>
        <p className="mt-0.5 text-sm text-muted">
          {formatDaysRemaining(alert.daysRemaining)} ·{' '}
          {formatMembershipDate(alert.membershipExpiresOn)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/members?q=${encodeURIComponent(alert.name)}`}
          className="hidden text-sm font-medium text-brand hover:underline sm:inline"
        >
          View member
        </Link>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => dismiss.mutate()}
          loading={dismiss.isPending}
        >
          Dismiss
        </Button>
      </div>
    </li>
  )
}
