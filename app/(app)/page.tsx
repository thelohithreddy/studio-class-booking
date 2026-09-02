'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { qk, useApiQuery } from '@app/_lib/query'
import { useAlerts } from '@app/_lib/use-alerts'
import {
  formatDateShort,
  formatDaysRemaining,
  formatMembershipDate,
  pluralize,
} from '@app/_lib/format'
import { BOOKING_STATUS, membershipFromDays, type Tone } from '@app/_lib/status'
import { barHeightPercent, type DashboardDto } from '@/lib/dashboard-dto'
import type { MembershipAlert, SessionListResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Avatar,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
  StatusBadge,
} from '@app/_components/ui'
import { ScheduleRow } from '@app/_components/schedule'
import { IconChart, IconMembers, IconSessions } from '@app/_components/icons'
import { useIsStaff } from './_shell/user-context'

export default function DashboardPage() {
  const staff = useIsStaff()
  const router = useRouter()
  const [greeting] = useState(() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  })
  const [dates] = useState(() => {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { today: key(new Date()), tomorrow: key(new Date(Date.now() + 86_400_000)) }
  })

  // The dashboard is a studio-wide, staff-only view. Instructors get their
  // scoped home instead (the server also enforces this — 403 on the API).
  useEffect(() => {
    if (!staff) router.replace('/sessions')
  }, [staff, router])

  const dashboard = useApiQuery<DashboardDto>(qk.dashboard, '/api/dashboard', { enabled: staff })
  const alerts = useAlerts(staff)
  const today = useApiQuery<SessionListResponse>(
    qk.sessions({ dash: 'today' }),
    `/api/sessions?from=${dates.today}&to=${dates.tomorrow}&pageSize=50`,
    { enabled: staff },
  )
  const attention = alerts.data?.count ?? 0

  if (!staff) return null

  return (
    <div className="flex flex-col gap-6">
      <AsyncBoundary query={dashboard} skeleton={<DashboardSkeleton />}>
        {(data) => (
          <>
            <header className="flex flex-col gap-1">
              <h1 className="text-[1.6rem] font-semibold tracking-tight text-fg">{greeting}</h1>
              <p className="text-sm text-muted">
                <span className="tabular font-medium text-fg">
                  {pluralize(data.headline.sessionsToday, 'session')}
                </span>{' '}
                today
                {attention > 0 ? (
                  <>
                    {' · '}
                    <Link href="/alerts" className="font-medium text-brand hover:underline">
                      {attention} {attention === 1 ? 'membership needs' : 'memberships need'}{' '}
                      attention
                    </Link>
                  </>
                ) : (
                  ' · all memberships current'
                )}
              </p>
            </header>

            {/* Today metrics — one panel, four cells. */}
            <Card>
              <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
                <Metric tone="info" label="Sessions today" value={data.headline.sessionsToday} />
                <Metric
                  tone="success"
                  label="Bookings today"
                  value={data.headline.bookingsMadeToday}
                />
                <Metric
                  tone="danger"
                  label="No-shows this week"
                  value={data.headline.noShowsThisWeek}
                  quiet={data.headline.noShowsThisWeek === 0}
                />
                <Metric
                  tone="warning"
                  label="On the waitlist"
                  value={data.headline.membersWaitlisted}
                  quiet={data.headline.membersWaitlisted === 0}
                />
              </div>
            </Card>

            {/* Operational focus: today's schedule + what needs attention. */}
            <div className="grid gap-5 lg:grid-cols-5">
              <Card className="overflow-hidden lg:col-span-3">
                <CardHeader
                  title="Today's schedule"
                  actions={
                    <Link
                      href="/sessions"
                      className="text-[0.8125rem] font-medium text-brand hover:underline"
                    >
                      View schedule
                    </Link>
                  }
                />
                <TodaySchedule query={today} />
              </Card>

              <Card className="overflow-hidden lg:col-span-2">
                <CardHeader
                  title="Needs attention"
                  actions={
                    attention > 0 ? (
                      <Link
                        href="/alerts"
                        className="text-[0.8125rem] font-medium text-brand hover:underline"
                      >
                        View all
                      </Link>
                    ) : undefined
                  }
                />
                <NeedsAttention alerts={alerts.data?.alerts ?? []} loading={alerts.isPending} />
              </Card>
            </div>

            {/* Activity. */}
            <div className="grid gap-5 lg:grid-cols-5">
              <Card className="lg:col-span-2">
                <CardHeader title="Bookings by status" description="Across all bookings." />
                <CardBody>
                  <StatusBreakdown data={data.bookingsByStatus} />
                </CardBody>
              </Card>
              <Card className="lg:col-span-3">
                <CardHeader title="Attendance" description="Members attended, last 8 weeks." />
                <CardBody>
                  <AttendanceChart data={data.attendanceByWeek} />
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="Busiest classes" description="Total bookings by class." />
              <CardBody>
                <ClassBreakdown data={data.bookingsByClass} />
              </CardBody>
            </Card>
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}

function TodaySchedule({ query }: { query: ReturnType<typeof useApiQuery<SessionListResponse>> }) {
  return (
    <AsyncBoundary
      query={query}
      skeleton={
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      }
      isEmpty={(d) => d.sessions.length === 0}
      empty={
        <EmptyState
          icon={<IconSessions className="size-5" />}
          title="No sessions today"
          description="Your schedule is clear. Enjoy the quiet — or get ahead on next week."
        />
      }
    >
      {(data) => (
        <div className="flex flex-col p-2">
          {data.sessions.map((s) => (
            <ScheduleRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </AsyncBoundary>
  )
}

function NeedsAttention({ alerts, loading }: { alerts: MembershipAlert[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="p-4">
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={<IconMembers className="size-5" />}
        title="You're all caught up"
        description="No memberships need attention right now."
      />
    )
  }
  return (
    <ul className="divide-y divide-line">
      {alerts.slice(0, 5).map((a) => {
        const meta = membershipFromDays(a.daysRemaining)
        return (
          <li
            key={`${a.memberId}-${a.membershipExpiresOn}`}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Avatar name={a.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.875rem] font-medium text-fg">{a.name}</p>
              <p className="truncate text-xs text-muted">
                {formatDaysRemaining(a.daysRemaining)} ·{' '}
                {formatMembershipDate(a.membershipExpiresOn)}
              </p>
            </div>
            <StatusBadge meta={meta} />
          </li>
        )
      })}
    </ul>
  )
}

function Metric({
  tone,
  label,
  value,
  quiet,
}: {
  tone: Tone
  label: string
  value: number
  quiet?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5">
      <span className="flex items-center gap-1.5">
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: quiet ? 'var(--subtle)' : `var(--tone-${tone})` }}
          aria-hidden="true"
        />
        <span className="eyebrow">{label}</span>
      </span>
      <span className="tabular text-[1.9rem] leading-none font-semibold text-fg">{value}</span>
    </div>
  )
}

function StatusBreakdown({ data }: { data: DashboardDto['bookingsByStatus'] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  if (total === 0) {
    return <p className="py-6 text-center text-sm text-muted">No bookings recorded yet.</p>
  }
  return (
    <ul className="flex flex-col gap-3.5">
      {data.map((row) => {
        const meta = BOOKING_STATUS[row.status]
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
        return (
          <li key={row.status}>
            <div className="mb-1.5 flex items-center justify-between text-[0.8125rem]">
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `var(--tone-${meta.tone})` }}
                  aria-hidden="true"
                />
                <span className="text-fg">{meta.label}</span>
              </span>
              <span className="tabular text-muted">
                <span className="font-semibold text-fg">{row.count}</span> · {pct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${pct}%`, backgroundColor: `var(--tone-${meta.tone})` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function AttendanceChart({ data }: { data: DashboardDto['attendanceByWeek'] }) {
  const max = Math.max(...data.map((d) => d.attended), 0)
  const totalAttended = data.reduce((sum, d) => sum + d.attended, 0)

  return (
    <div>
      <div className="flex h-40 items-end justify-between gap-2.5" aria-hidden="true">
        {data.map((week) => {
          const height = barHeightPercent(week.attended, max)
          return (
            <div
              key={week.weekStart}
              className="group flex h-full flex-1 flex-col items-center justify-end gap-2"
            >
              <span className="tabular text-xs font-medium text-muted">{week.attended}</span>
              <div
                className="w-full max-w-9 rounded-t-[5px] bg-brand/85 transition-[height] group-hover:bg-brand"
                style={{ height: `${Math.max(height, week.attended > 0 ? 3 : 1)}%` }}
                title={`Week of ${formatDateShort(week.weekStart)}: ${week.attended} attended`}
              />
              <span className="text-[0.6875rem] text-subtle">
                {formatDateShort(week.weekStart)}
              </span>
            </div>
          )
        })}
      </div>
      <table className="sr-only">
        <caption>Attendance per week over the last eight weeks</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">Members attended</th>
          </tr>
        </thead>
        <tbody>
          {data.map((week) => (
            <tr key={week.weekStart}>
              <td>{week.weekStart}</td>
              <td>{week.attended}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        <span className="tabular font-semibold text-fg">{totalAttended}</span> attended over the
        last 8 weeks.
      </p>
    </div>
  )
}

function ClassBreakdown({ data }: { data: DashboardDto['bookingsByClass'] }) {
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<IconChart className="size-5" />}
        title="No bookings yet"
        description="Once members start booking, the busiest classes will rank here."
      />
    )
  }
  const max = Math.max(...data.map((d) => d.count), 0)
  return (
    <ul className="flex flex-col gap-3">
      {data.slice(0, 8).map((row) => (
        <li key={row.classId} className="flex items-center gap-3">
          <Link
            href={`/classes/${row.classId}`}
            className="w-40 shrink-0 truncate text-[0.8125rem] font-medium text-fg hover:text-brand sm:w-56"
            title={row.classTitle}
          >
            {row.classTitle}
          </Link>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand/80"
              style={{ width: `${max > 0 ? Math.round((row.count / max) * 100) : 0}%` }}
            />
          </div>
          <span className="tabular w-8 shrink-0 text-right text-[0.8125rem] font-semibold text-fg">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-5">
        <Skeleton className="h-64 rounded-xl lg:col-span-3" />
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Skeleton className="h-56 rounded-xl lg:col-span-2" />
        <Skeleton className="h-56 rounded-xl lg:col-span-3" />
      </div>
    </div>
  )
}
