'use client'

import { useState } from 'react'

import { api, Button, Field, Notice, useResource } from '../ui'

interface Klass {
  id: string
  title: string
  discipline: string
  defaultDurationMinutes: number
  defaultCapacity: number
  archivedAt: string | null
}

export default function ClassesPage() {
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data, error, loading, reload } = useResource<{ classes: Klass[]; total: number }>(
    `/api/classes?includeArchived=${includeArchived}`,
  )
  const [form, setForm] = useState({
    title: '',
    description: '',
    discipline: '',
    duration: '60',
    capacity: '20',
  })
  const [formError, setFormError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await api('/api/classes', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          discipline: form.discipline,
          defaultDurationMinutes: Number(form.duration),
          defaultCapacity: Number(form.capacity),
        }),
      })
      setForm({ title: '', description: '', discipline: '', duration: '60', capacity: '20' })
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  async function toggle(k: Klass) {
    await api(`/api/classes/${k.id}/${k.archivedAt ? 'restore' : 'archive'}`, { method: 'POST' })
    reload()
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Classes</h1>

      <form
        onSubmit={create}
        className="grid grid-cols-2 gap-3 rounded border border-slate-200 p-4 dark:border-slate-800"
      >
        <Field
          label="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />
        <Field
          label="Discipline"
          value={form.discipline}
          onChange={(e) => setForm({ ...form, discipline: e.target.value })}
          required
        />
        <Field
          label="Default duration (min)"
          type="number"
          value={form.duration}
          onChange={(e) => setForm({ ...form, duration: e.target.value })}
          required
        />
        <Field
          label="Default capacity"
          type="number"
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          required
        />
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="font-medium">Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <div className="col-span-2 flex items-center gap-3">
          <Button type="submit">Add class</Button>
          <Notice error={formError} />
        </div>
      </form>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Show archived
      </label>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <Notice error={error} />
      {data && data.classes.length === 0 ? (
        <p className="text-sm text-slate-500">No classes yet.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data?.classes.map((k) => (
          <li
            key={k.id}
            className="flex items-center justify-between rounded border border-slate-200 px-4 py-2 text-sm dark:border-slate-800"
          >
            <span>
              <strong>{k.title}</strong> · {k.discipline} · {k.defaultDurationMinutes}min · cap{' '}
              {k.defaultCapacity}
              {k.archivedAt ? <em className="ml-2 text-slate-400">archived</em> : null}
            </span>
            <button onClick={() => toggle(k)} className="text-slate-500 hover:underline">
              {k.archivedAt ? 'Restore' : 'Archive'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
