// app/_components/landing/booking-story.tsx
//
// A static, three-step visual of the booking lifecycle — the assignment's
// strongest feature. Decorative graphics are aria-hidden; each step carries a
// real text caption so the story is legible to a screen reader.

function Seats({ filled, capacity, freed }: { filled: number; capacity: number; freed?: number }) {
  return (
    <div className="flex flex-wrap gap-1" aria-hidden="true">
      {Array.from({ length: capacity }).map((_, i) => {
        const isFilled = i < filled
        const isFreed = freed !== undefined && i === freed
        return (
          <span
            key={i}
            className={
              isFreed
                ? 'size-2.5 rounded-full border border-dashed border-brand'
                : isFilled
                  ? 'size-2.5 rounded-full bg-brand'
                  : 'size-2.5 rounded-full bg-surface-3'
            }
          />
        )
      })}
    </div>
  )
}

function Queue({ names, promotedIndex }: { names: string[]; promotedIndex?: number }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-hidden="true">
      {names.map((n, i) => (
        <li
          key={n}
          className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
            i === promotedIndex ? 'bg-brand-subtle font-medium text-brand-subtle-fg' : 'text-muted'
          }`}
        >
          <span className="tabular text-[0.65rem] text-subtle">{i + 1}</span>
          <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[0.6rem] font-semibold text-muted">
            {n
              .split(' ')
              .map((p) => p[0])
              .join('')}
          </span>
          <span className="truncate">{n}</span>
          {i === promotedIndex ? <span className="ml-auto text-[0.65rem]">→ booked</span> : null}
        </li>
      ))}
    </ul>
  )
}

function Step({
  n,
  title,
  caption,
  children,
}: {
  n: number
  title: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <span className="tabular flex size-5 items-center justify-center rounded-full bg-fg text-[0.65rem] font-semibold text-canvas">
          {n}
        </span>
        <span className="text-[0.9rem] font-semibold text-fg">{title}</span>
      </div>
      <div className="min-h-[3.5rem]">{children}</div>
      <p className="text-[0.8125rem] leading-relaxed text-muted">{caption}</p>
    </div>
  )
}

export function BookingStory() {
  return (
    <div className="flex flex-col items-stretch gap-3 lg:flex-row">
      <Step
        n={1}
        title="The class fills"
        caption="Members book up to capacity. The 12th seat takes the last spot — the class is now full."
      >
        <div className="flex items-center justify-between">
          <Seats filled={12} capacity={12} />
          <span className="tone-danger rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold">
            Full
          </span>
        </div>
      </Step>

      <span aria-hidden="true" className="hidden self-center text-subtle lg:block">
        →
      </span>

      <Step
        n={2}
        title="A waitlist forms"
        caption="Further sign-ups join a first-in, first-out waitlist — the order is kept exactly."
      >
        <Queue names={['Mara Diaz', 'Ken Ito', 'Priya Rao']} />
      </Step>

      <span aria-hidden="true" className="hidden self-center text-subtle lg:block">
        →
      </span>

      <Step
        n={3}
        title="A cancel promotes the next"
        caption="Someone cancels; the earliest waitlisted member is promoted into the seat automatically — no staff action, no double-booking."
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Seats filled={11} capacity={12} freed={11} />
            <span className="tone-success rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold">
              Promoted
            </span>
          </div>
          <Queue names={['Mara Diaz', 'Ken Ito', 'Priya Rao']} promotedIndex={0} />
        </div>
      </Step>
    </div>
  )
}
