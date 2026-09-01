'use client'

import { useState } from 'react'

import { api, Button, Field, Notice, useResource } from '../ui'

interface Session {
  id: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  class: { title: string; discipline: string }
  room: { name: string }
  primaryInstructor: { id: string; name: string }
}

interface ClassLite {
  id: string
  title: string
}
interface RoomLite {
  id: string
  name: string
}

export default function SessionsPage() {
  const { data, error, loading, reload } = useResource<{ sessions: Session[]; total: number }>(
    '/api/sessions',
  )
  // These lists are staff-only; an instructor's fetch 403s and the pickers stay empty
  // (their view is read-only anyway).
  const classes = useResource<{ classes: ClassLite[] }>('/api/classes')
  const rooms = useResource<{ rooms: RoomLite[] }>('/api/rooms')
  const canCreateData = classes.data && rooms.data && !classes.error && !rooms.error

  const [form, setForm] = useState({
    classId: '',
    startsAt: '',
    primaryInstructorId: '',
    roomId: '',
    duration: '',
    capacity: '',
  })
  const [formError, setFormError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          classId: form.classId,
          startsAt: new Date(form.startsAt).toISOString(),
          primaryInstructorId: form.primaryInstructorId,
          roomId: form.roomId,
          ...(form.duration ? { durationMinutes: Number(form.duration) } : {}),
          ...(form.capacity ? { capacity: Number(form.capacity) } : {}),
        }),
      })
      setForm({
        classId: '',
        startsAt: '',
        primaryInstructorId: '',
        roomId: '',
        duration: '',
        capacity: '',
      })
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Sessions</h1>

      {canCreateData ? (
        <form
          onSubmit={create}
          className="grid grid-cols-2 gap-3 rounded border border-slate-200 p-4 dark:border-slate-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Class</span>
            <select
              required
              value={form.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
              className="rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Select…</option>
              {classes.data?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Room</span>
            <select
              required
              value={form.roomId}
              onChange={(e) => setForm({ ...form, roomId: e.target.value })}
              className="rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Select…</option>
              {rooms.data?.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Primary instructor (user id)"
            value={form.primaryInstructorId}
            onChange={(e) => setForm({ ...form, primaryInstructorId: e.target.value })}
            required
          />
          <Field
            label="Starts at"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            required
          />
          <Field
            label="Duration (min, optional)"
            type="number"
            value={form.duration}
            onChange={(e) => setForm({ ...form, duration: e.target.value })}
          />
          <Field
            label="Capacity (optional)"
            type="number"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit">Schedule session</Button>
            <Notice error={formError} />
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Your scheduled sessions.</p>
      )}

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <Notice error={error} />
      {data && data.sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No sessions.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data?.sessions.map((s) => (
          <li
            key={s.id}
            className="rounded border border-slate-200 px-4 py-2 text-sm dark:border-slate-800"
          >
            <strong>{s.class.title}</strong> · {new Date(s.startsAt).toLocaleString()} –{' '}
            {new Date(s.endsAt).toLocaleTimeString()} · {s.room.name} · {s.primaryInstructor.name} ·{' '}
            {s.bookedCount}/{s.capacity}
          </li>
        ))}
      </ul>
    </section>
  )
}
