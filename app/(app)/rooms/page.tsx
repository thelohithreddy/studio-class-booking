'use client'

import { useState } from 'react'

import { api, Button, Field, Notice, useResource } from '../ui'

interface Room {
  id: string
  name: string
}

export default function RoomsPage() {
  const { data, error, loading, reload } = useResource<{ rooms: Room[] }>('/api/rooms')
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) })
      setName('')
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Rooms</h1>
      <form
        onSubmit={create}
        className="flex items-end gap-3 rounded border border-slate-200 p-4 dark:border-slate-800"
      >
        <Field label="Room name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit">Add room</Button>
        <Notice error={formError} />
      </form>
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <Notice error={error} />
      {data && data.rooms.length === 0 ? (
        <p className="text-sm text-slate-500">No rooms yet.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data?.rooms.map((r) => (
          <li
            key={r.id}
            className="rounded border border-slate-200 px-4 py-2 text-sm dark:border-slate-800"
          >
            {r.name}
          </li>
        ))}
      </ul>
    </section>
  )
}
