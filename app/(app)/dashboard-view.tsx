// app/(app)/dashboard-view.tsx
import type { BookingStatus } from '@/generated/prisma/enums'
import { barHeightPercent, type DashboardDto } from '@/lib/dashboard-dto'

// Presentation-only labels — the DTO/API keep the canonical status tokens.
const STATUS_LABEL: Record<BookingStatus, string> = {
  BOOKED: 'Booked',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  ATTENDED: 'Attended',
  NO_SHOW: 'No-show',
}

function studioTimestamp(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

const cell = 'border-b border-slate-100 px-3 py-1.5 text-sm dark:border-slate-800'
const th = `${cell} text-left font-medium text-slate-500`

export function DashboardView({ data }: { data: DashboardDto }) {
  const { headline, bookingsByStatus, bookingsByClass, attendanceByWeek } = data
  const maxAttended = Math.max(0, ...attendanceByWeek.map((w) => w.attended))
  const hasAttendance = maxAttended > 0

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-xs text-slate-500">
          Studio-wide, as of {studioTimestamp(data.generatedAt, data.timezone)} ({data.timezone})
        </p>
      </div>

      {/* Headline numbers */}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sessions today" value={headline.sessionsToday} />
        <Stat label="Bookings made today" value={headline.bookingsMadeToday} />
        <Stat label="No-shows this week" value={headline.noShowsThisWeek} />
        <Stat label="Members waitlisted" value={headline.membersWaitlisted} />
      </dl>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Bookings by status */}
        <section aria-labelledby="by-status-h">
          <h2 id="by-status-h" className="mb-2 text-base font-semibold">
            Bookings by status
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">Total bookings grouped by status</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Status
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Bookings
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookingsByStatus.map((row) => (
                  <tr key={row.status}>
                    <th scope="row" className={`${cell} font-normal`}>
                      {STATUS_LABEL[row.status]}
                    </th>
                    <td className={`${cell} text-right tabular-nums`}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bookings by class */}
        <section aria-labelledby="by-class-h">
          <h2 id="by-class-h" className="mb-2 text-base font-semibold">
            Bookings by class
          </h2>
          {bookingsByClass.length === 0 ? (
            <p className="text-sm text-slate-500">No bookings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">Total bookings grouped by class</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Class
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Bookings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bookingsByClass.map((row) => (
                    <tr key={row.classId}>
                      <th scope="row" className={`${cell} font-normal`}>
                        {row.classTitle}
                      </th>
                      <td className={`${cell} text-right tabular-nums`}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Attendance per week (last 8 weeks) */}
      <section aria-labelledby="attendance-h">
        <h2 id="attendance-h" className="mb-2 text-base font-semibold">
          Attendance per week (last 8 weeks)
        </h2>
        {!hasAttendance ? (
          <p className="text-sm text-slate-500">No attendance recorded in the last 8 weeks.</p>
        ) : (
          // Decorative bar chart — the data table below is the accessible source.
          <div
            aria-hidden="true"
            className="flex h-40 items-end gap-2 rounded border border-slate-200 p-3 dark:border-slate-800"
          >
            {attendanceByWeek.map((w) => (
              <div
                key={w.weekStart}
                className="flex flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-xs tabular-nums text-slate-500">{w.attended}</span>
                <div
                  className="w-full rounded-t bg-slate-700 dark:bg-slate-300"
                  style={{ height: `${barHeightPercent(w.attended, maxAttended)}%` }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Attended bookings per studio-local week, last eight weeks
            </caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Week of
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Attended
                </th>
              </tr>
            </thead>
            <tbody>
              {attendanceByWeek.map((w) => (
                <tr key={w.weekStart}>
                  <th scope="row" className={`${cell} font-normal`}>
                    {w.weekStart}
                  </th>
                  <td className={`${cell} text-right tabular-nums`}>{w.attended}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
