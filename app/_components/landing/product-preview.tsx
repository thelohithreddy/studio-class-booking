// app/_components/landing/product-preview.tsx
//
// A faithful, STATIC snapshot of the real staff dashboard for the landing hero —
// same layout language as app/(app)/dashboard: metric cells, time-first schedule
// rows with a fill-toned accent rail, and an attendance sparkline. Presentational
// only (no data, no client hooks); the numbers are illustrative sample data, not
// fabricated features.

type Fill = 'success' | 'warning' | 'danger'

const METRICS: { label: string; value: string; tone: string }[] = [
  { label: 'Sessions today', value: '6', tone: 'info' },
  { label: 'Bookings today', value: '24', tone: 'success' },
  { label: 'On waitlist', value: '5', tone: 'warning' },
]

const SCHEDULE: {
  time: string
  dur: string
  title: string
  discipline: string
  where: string
  booked: number
  capacity: number
  fill: Fill
  label: string
}[] = [
  {
    time: '6:00',
    dur: '60m',
    title: 'Sunrise Vinyasa',
    discipline: 'Yoga',
    where: 'Studio A · Ivy Chen',
    booked: 18,
    capacity: 18,
    fill: 'danger',
    label: 'Full',
  },
  {
    time: '9:30',
    dur: '50m',
    title: 'Reformer Pilates',
    discipline: 'Pilates',
    where: 'Studio B · Leo Park',
    booked: 11,
    capacity: 12,
    fill: 'warning',
    label: 'Filling up',
  },
  {
    time: '12:00',
    dur: '45m',
    title: 'Express Barre',
    discipline: 'Barre',
    where: 'Studio A · Ivy Chen',
    booked: 9,
    capacity: 20,
    fill: 'success',
    label: 'Open',
  },
]

const BARS = [6, 9, 7, 12, 10, 14, 11, 16]

export function ProductPreview() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-30px_rgba(41,38,35,0.45)]"
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="ml-2 text-[0.7rem] font-medium text-subtle">cadence · dashboard</span>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div>
          <p className="font-display text-lg text-fg">Good morning</p>
          <p className="text-xs text-muted">
            <span className="font-medium text-fg">6 sessions</span> today · 2 memberships need
            attention
          </p>
        </div>

        {/* metrics */}
        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line">
          {METRICS.map((m, i) => (
            <div
              key={m.label}
              className={`flex flex-col gap-1.5 px-3 py-3 ${i > 0 ? 'border-l border-line' : ''}`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: `var(--tone-${m.tone})` }}
                />
                <span className="eyebrow text-[0.6rem]">{m.label}</span>
              </span>
              <span className="tabular text-xl leading-none font-semibold text-fg">{m.value}</span>
            </div>
          ))}
        </div>

        {/* today's schedule */}
        <div className="rounded-xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-[0.8125rem] font-semibold text-fg">Today&rsquo;s schedule</span>
            <span className="text-[0.7rem] font-medium text-brand">View schedule</span>
          </div>
          <div className="flex flex-col p-1.5">
            {SCHEDULE.map((s) => (
              <div key={s.title} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                <div className="w-9 shrink-0 text-right">
                  <div className="tabular text-[0.8125rem] leading-tight font-semibold text-fg">
                    {s.time}
                  </div>
                  <div className="text-[0.6rem] text-subtle">{s.dur}</div>
                </div>
                <span
                  className="h-8 w-0.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--tone-${s.fill})` }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[0.8125rem] font-semibold text-fg">
                      {s.title}
                    </span>
                    <span className="hidden rounded-full bg-surface-2 px-1.5 py-px text-[0.6rem] font-medium text-muted sm:inline">
                      {s.discipline}
                    </span>
                  </div>
                  <div className="truncate text-[0.7rem] text-muted">{s.where}</div>
                </div>
                <div className="flex w-16 shrink-0 flex-col items-end gap-1">
                  <span className="tabular text-[0.7rem] font-medium text-fg">
                    {s.booked}/{s.capacity}
                  </span>
                  <span className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.round((s.booked / s.capacity) * 100)}%`,
                        backgroundColor: `var(--tone-${s.fill})`,
                      }}
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* attendance sparkline */}
        <div className="rounded-xl border border-line px-3.5 py-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[0.8125rem] font-semibold text-fg">Attendance</span>
            <span className="text-[0.7rem] text-subtle">last 8 weeks</span>
          </div>
          <div className="flex h-14 items-end justify-between gap-1.5">
            {BARS.map((v, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-[3px] bg-brand/80"
                style={{ height: `${Math.round((v / Math.max(...BARS)) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
