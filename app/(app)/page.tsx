'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { qk, useApiQuery } from '@app/_lib/query'
import { formatDateShort } from '@app/_lib/format'
import { BOOKING_STATUS, type Tone } from '@app/_lib/status'
import { barHeightPercent, type DashboardDto } from '@/lib/dashboard-dto'
import {
  AsyncBoundary,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@app/_components/ui'
import { IconBookings, IconChart, IconClock, IconSessions, IconX } from '@app/_components/icons'
import { useIsStaff } from './_shell/user-context'

export default function DashboardPage() {
  const staff = useIsStaff()
  const router = useRouter()

  // The dashboard is a studio-wide, staff-only view. Instructors get their
  // scoped home instead (the server also enforces this — 403 on the API).
  useEffect(() => {
    if (!staff) router.replace('/sessions')
  }, [staff, router])

  const dashboard = useApiQuery<DashboardDto>(qk.dashboard, '/api/dashboard', { enabled: staff })

  if (!staff) return null

  return (
    <div className="flex flex-col gap-6">
      <AsyncBoundary query={dashboard} skeleton={<DashboardSkeleton />}>
        {(data) => (
          <>
            <PageHeader
              title="Dashboard"
              description={`Today across your studio · times in ${data.timezone}`}
            />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                tone="info"
                icon={<IconSessions className="size-5" />}
                label="Sessions today"
                value={data.headline.sessionsToday}
              />
              <StatCard
                tone="success"
                icon={<IconBookings className="size-5" />}
                label="Bookings today"
                value={data.headline.bookingsMadeToday}
              />
              <StatCard
                tone="danger"
                icon={<IconX className="size-5" />}
                label="No-shows this week"
                value={data.headline.noShowsThisWeek}
              />
              <StatCard
                tone="warning"
                icon={<IconClock className="size-5" />}
                label="Waitlisted now"
                value={data.headline.membersWaitlisted}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="lg:col-span-2">
                <CardHeader title="Bookings by status" description="All bookings, every status." />
                <CardBody>
                  <StatusBreakdown data={data.bookingsByStatus} />
                </CardBody>
              </Card>

              <Card className="lg:col-span-3">
                <CardHeader
                  title="Attendance"
                  description="Members marked attended each week, last 8 weeks."
                />
                <CardBody>
                  <AttendanceChart data={data.attendanceByWeek} />
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader
                title="Bookings by class"
                description="Which classes draw the most bookings."
              />
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

function StatCard({
  tone,
  icon,
  label,
  value,
}: {
  tone: Tone
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `var(--tone-${tone}-bg)`, color: `var(--tone-${tone})` }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">{label}</p>
          <p className="tabular text-2xl font-semibold text-fg">{value}</p>
        </div>
      </div>
    </Card>
  )
}

function StatusBreakdown({ data }: { data: DashboardDto['bookingsByStatus'] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  if (total === 0) {
    return <p className="py-4 text-center text-sm text-muted">No bookings recorded yet.</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {data.map((row) => {
        const meta = BOOKING_STATUS[row.status]
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0
        return (
          <li key={row.status}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: `var(--tone-${meta.tone})` }}
                  aria-hidden="true"
                />
                <span className="text-fg">{meta.label}</span>
              </span>
              <span className="tabular text-muted">
                <span className="font-semibold text-fg">{row.count}</span> · {pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
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
      <div className="flex h-40 items-end justify-between gap-2" aria-hidden="true">
        {data.map((week) => {
          const height = barHeightPercent(week.attended, max)
          return (
            <div
              key={week.weekStart}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            >
              <span className="tabular text-xs font-medium text-muted">{week.attended}</span>
              <div
                className="w-full rounded-t bg-brand transition-[height]"
                style={{ height: `${Math.max(height, week.attended > 0 ? 4 : 1)}%` }}
                title={`Week of ${formatDateShort(week.weekStart)}: ${week.attended} attended`}
              />
              <span className="text-[0.65rem] text-subtle">{formatDateShort(week.weekStart)}</span>
            </div>
          )
        })}
      </div>
      {/* Accessible equivalent of the chart. */}
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
      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
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
    <ul className="flex flex-col gap-2.5">
      {data.slice(0, 8).map((row) => (
        <li key={row.classId} className="flex items-center gap-3">
          <Link
            href={`/classes/${row.classId}`}
            className="w-40 shrink-0 truncate text-sm font-medium text-fg hover:text-brand sm:w-56"
            title={row.classTitle}
          >
            {row.classTitle}
          </Link>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${max > 0 ? Math.round((row.count / max) * 100) : 0}%` }}
            />
          </div>
          <span className="tabular w-8 shrink-0 text-right text-sm font-semibold text-fg">
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
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64 lg:col-span-3" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
