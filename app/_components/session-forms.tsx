// app/_components/session-forms.tsx
'use client'

import { useState } from 'react'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useInvalidate } from '@app/_lib/query'
import { formatMembershipDate, toDateTimeLocalValue } from '@app/_lib/format'
import { useResetOnOpen } from '@app/_lib/use-reset-on-open'
import type { GenerateResult, SessionResponse } from '@app/_lib/types'
import {
  Button,
  Callout,
  Drawer,
  TextInput,
  useToast,
  type ComboboxItem,
} from '@app/_components/ui'
import { ClassPicker, InstructorPicker, RoomPicker } from '@app/_components/pickers'

/** Everything the edit form needs to prefill, normalized across list/detail shapes. */
export interface EditSessionInit {
  id: string
  classId: string
  classTitle: string
  startsAt: string
  durationMinutes: number
  capacity: number
  primaryInstructorId: string
  primaryInstructorName: string
  roomId: string
  roomName: string
}

const FIELD_LABELS = {
  instructor: 'Primary instructor',
  room: 'Room',
  start: 'Start date and time',
  duration: 'Duration (minutes)',
  capacity: 'Maximum participants',
}

/**
 * Create or edit a single session. On create, `classId` may be fixed (scheduling
 * from a class) or chosen with a ClassPicker. Times are entered in the viewer's
 * local wall clock and sent as an absolute instant. Scheduling conflicts (room
 * or instructor already booked, archived class, not-an-instructor) come back as
 * clear server messages surfaced inline.
 */
export function SessionFormDrawer({
  open,
  onClose,
  fixedClassId,
  edit,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  fixedClassId?: string
  edit?: EditSessionInit | null
  onSaved?: () => void
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const isEdit = Boolean(edit)

  const blank = {
    classId: fixedClassId ?? '',
    primaryInstructorId: '',
    roomId: '',
    startsAt: '',
    durationMinutes: '',
    capacity: '',
  }
  const [form, setForm] = useState(blank)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = edit ? edit.id : open ? `create:${fixedClassId ?? 'any'}` : null
  if (open && key !== lastKey) {
    setLastKey(key)
    setForm(
      edit
        ? {
            classId: edit.classId,
            primaryInstructorId: edit.primaryInstructorId,
            roomId: edit.roomId,
            startsAt: toDateTimeLocalValue(edit.startsAt),
            durationMinutes: String(edit.durationMinutes),
            capacity: String(edit.capacity),
          }
        : blank,
    )
  }
  if (!open && lastKey !== null) setLastKey(null)

  const mutation = useApiMutation(
    () => {
      const startIso = new Date(form.startsAt).toISOString()
      if (isEdit && edit) {
        const body: Record<string, unknown> = {
          startsAt: startIso,
          primaryInstructorId: form.primaryInstructorId,
          roomId: form.roomId,
          durationMinutes: Number(form.durationMinutes),
          capacity: Number(form.capacity),
        }
        return apiSend<SessionResponse>(`/api/sessions/${edit.id}`, 'PATCH', body)
      }
      const body: Record<string, unknown> = {
        classId: form.classId,
        primaryInstructorId: form.primaryInstructorId,
        roomId: form.roomId,
        startsAt: startIso,
      }
      if (form.durationMinutes) body.durationMinutes = Number(form.durationMinutes)
      if (form.capacity) body.capacity = Number(form.capacity)
      return apiSend<SessionResponse>('/api/sessions', 'POST', body)
    },
    {
      onSuccess: () => {
        invalidate([
          qk.sessions(),
          qk.class(form.classId),
          edit ? qk.session(edit.id) : qk.sessions(),
        ])
        toast.success(isEdit ? 'Session updated' : 'Session scheduled')
        onSaved?.()
        onClose()
      },
    },
  )
  useResetOnOpen(open, mutation.reset)

  const instructorItem: ComboboxItem | null = edit
    ? { value: edit.primaryInstructorId, label: edit.primaryInstructorName }
    : null
  const roomItem: ComboboxItem | null = edit ? { value: edit.roomId, label: edit.roomName } : null

  const canSubmit =
    Boolean(form.primaryInstructorId && form.roomId && form.startsAt) &&
    (isEdit || Boolean(form.classId))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit session' : 'Schedule session'}
      description={
        isEdit
          ? undefined
          : 'Duration and capacity default from the class — leave them blank to inherit.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="session-form"
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            {isEdit ? 'Save changes' : 'Schedule session'}
          </Button>
        </>
      }
    >
      <form
        id="session-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) mutation.mutate()
        }}
        className="flex flex-col gap-4"
      >
        {mutation.error ? (
          <Callout tone="danger" role="alert">
            {mutation.error.message}
          </Callout>
        ) : null}

        {isEdit ? (
          <div>
            <span className="text-[0.8125rem] font-medium text-fg">Class</span>
            <p className="mt-1.5 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
              {edit?.classTitle}
            </p>
          </div>
        ) : fixedClassId ? null : (
          <Field label="Class">
            <ClassPicker
              value={form.classId || null}
              onChange={(v) => setForm({ ...form, classId: v })}
            />
          </Field>
        )}

        <Field label={FIELD_LABELS.instructor}>
          <InstructorPicker
            value={form.primaryInstructorId || null}
            onChange={(v) => setForm({ ...form, primaryInstructorId: v })}
            selectedItem={instructorItem}
          />
        </Field>

        <Field label={FIELD_LABELS.room}>
          <RoomPicker
            value={form.roomId || null}
            onChange={(v) => setForm({ ...form, roomId: v })}
            selectedItem={roomItem}
          />
        </Field>

        <TextInput
          label={FIELD_LABELS.start}
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          hint="Entered in your local time."
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label={FIELD_LABELS.duration}
            type="number"
            min={1}
            max={1440}
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            placeholder={isEdit ? undefined : 'Class default'}
            required={isEdit}
          />
          <TextInput
            label={FIELD_LABELS.capacity}
            type="number"
            min={0}
            max={100000}
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            placeholder={isEdit ? undefined : 'Class default'}
            required={isEdit}
          />
        </div>
      </form>
    </Drawer>
  )
}

/** A small labeled shell for non-input controls (pickers) inside forms. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-fg">{label}</span>
      {children}
    </div>
  )
}

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

/**
 * Bulk-generate a class's sessions across a date range on a weekly pattern
 * (Goal 7). Explains what will happen before submit, and reports created vs
 * skipped afterward — a partial result never reads as a plain success.
 */
export function GenerateDrawer({
  open,
  onClose,
  classId,
}: {
  open: boolean
  onClose: () => void
  classId: string
}) {
  const invalidate = useInvalidate()
  const [form, setForm] = useState({
    primaryInstructorId: '',
    roomId: '',
    startDate: '',
    endDate: '',
    startTime: '18:00',
    durationMinutes: '',
    capacity: '',
  })
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [result, setResult] = useState<GenerateResult | null>(null)

  // Reset the whole form (fields, weekdays, and any previous result) each time
  // the drawer opens, so a new run never inherits the last one's inputs.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setResult(null)
    setForm({
      primaryInstructorId: '',
      roomId: '',
      startDate: '',
      endDate: '',
      startTime: '18:00',
      durationMinutes: '',
      capacity: '',
    })
    setWeekdays([])
  }
  if (!open && wasOpen) setWasOpen(false)

  function toggleDay(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  const mutation = useApiMutation(
    () => {
      const body: Record<string, unknown> = {
        classId,
        primaryInstructorId: form.primaryInstructorId,
        roomId: form.roomId,
        startDate: form.startDate,
        endDate: form.endDate,
        weekdays: [...weekdays].sort((a, b) => a - b),
        startTime: form.startTime,
      }
      if (form.durationMinutes) body.durationMinutes = Number(form.durationMinutes)
      if (form.capacity) body.capacity = Number(form.capacity)
      return apiSend<GenerateResult>('/api/sessions/generate', 'POST', body)
    },
    {
      onSuccess: (data) => {
        setResult(data)
        invalidate([qk.sessions(), qk.class(classId)])
      },
    },
  )
  useResetOnOpen(open, mutation.reset)

  const canSubmit = Boolean(
    form.primaryInstructorId &&
    form.roomId &&
    form.startDate &&
    form.endDate &&
    weekdays.length > 0,
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title="Generate recurring sessions"
      description="Create the same session repeating weekly across a date range. Occurrences that clash with an existing booking are skipped and reported."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="generate-form"
              loading={mutation.isPending}
              disabled={!canSubmit}
            >
              Generate sessions
            </Button>
          </>
        )
      }
    >
      {result ? (
        <GenerateSummary result={result} />
      ) : (
        <form
          id="generate-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          className="flex flex-col gap-4"
        >
          {mutation.error ? (
            <Callout tone="danger" role="alert">
              {mutation.error.message}
            </Callout>
          ) : null}

          <Field label="Primary instructor">
            <InstructorPicker
              value={form.primaryInstructorId || null}
              onChange={(v) => setForm({ ...form, primaryInstructorId: v })}
            />
          </Field>
          <Field label="Room">
            <RoomPicker
              value={form.roomId || null}
              onChange={(v) => setForm({ ...form, roomId: v })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label="From date"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
            <TextInput
              label="To date"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-medium text-fg">Repeat on</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeat on weekdays">
              {WEEKDAYS.map((day) => {
                const on = weekdays.includes(day.value)
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day.value)}
                    className={
                      'min-w-11 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                      (on
                        ? 'border-brand bg-brand-subtle text-brand-subtle-fg'
                        : 'border-line-strong bg-surface text-muted hover:bg-surface-2')
                    }
                  >
                    {day.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label="Start time"
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              hint="Studio local time"
              required
            />
            <TextInput
              label="Duration (minutes)"
              type="number"
              min={1}
              max={1440}
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              placeholder="Class default"
            />
          </div>
          <TextInput
            label="Maximum participants"
            type="number"
            min={0}
            max={100000}
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            placeholder="Class default"
            containerClassName="max-w-[calc(50%-0.375rem)]"
          />
        </form>
      )}
    </Drawer>
  )
}

function GenerateSummary({ result }: { result: GenerateResult }) {
  const { summary, skipped } = result
  const allCreated = summary.skipped === 0 && summary.created > 0
  const noneCreated = summary.created === 0
  const tone = allCreated ? 'success' : noneCreated ? 'warning' : 'info'
  const title = allCreated
    ? `Created ${summary.created} session${summary.created === 1 ? '' : 's'}`
    : noneCreated
      ? 'No sessions were created'
      : `Created ${summary.created}, skipped ${summary.skipped}`

  return (
    <div className="flex flex-col gap-4">
      <Callout tone={tone} title={title}>
        {allCreated
          ? 'Every occurrence in the range was scheduled.'
          : `${summary.requested} occurrence${summary.requested === 1 ? '' : 's'} matched your pattern. ${summary.skipped} ${summary.skipped === 1 ? 'was' : 'were'} skipped because the instructor or room was already booked.`}
      </Callout>

      {skipped.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Skipped occurrences</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
            {skipped.map((s, i) => (
              <li
                key={`${s.date}-${i}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-fg">{formatMembershipDate(s.date)}</span>
                <span className="text-muted">
                  {s.reason === 'room' ? 'Room already booked' : 'Instructor already booked'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
