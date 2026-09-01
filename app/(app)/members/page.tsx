'use client'

import { useState } from 'react'

import { api, Button, Field, Notice, useResource } from '../ui'

interface Member {
  id: string
  name: string
  email: string
  membershipExpiresOn: string
}

export default function MembersPage() {
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useResource<{ members: Member[]; total: number }>(
    `/api/members?q=${encodeURIComponent(q)}`,
  )
  const [form, setForm] = useState({ name: '', email: '', expiry: '' })
  const [formError, setFormError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await api('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          membershipExpiresOn: form.expiry,
        }),
      })
      setForm({ name: '', email: '', expiry: '' })
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Members</h1>

      <form
        onSubmit={create}
        className="grid grid-cols-3 gap-3 rounded border border-slate-200 p-4 dark:border-slate-800"
      >
        <Field
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <Field
          label="Membership expiry"
          type="date"
          value={form.expiry}
          onChange={(e) => setForm({ ...form, expiry: e.target.value })}
          required
        />
        <div className="col-span-3 flex items-center gap-3">
          <Button type="submit">Add member</Button>
          <Notice error={formError} />
        </div>
      </form>

      <Field
        label="Search"
        placeholder="name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <Notice error={error} />
      {data && data.members.length === 0 ? (
        <p className="text-sm text-slate-500">No members found.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data?.members.map((m) => (
          <li
            key={m.id}
            className="rounded border border-slate-200 px-4 py-2 text-sm dark:border-slate-800"
          >
            <strong>{m.name}</strong> · {m.email} · expires {m.membershipExpiresOn.slice(0, 10)}
          </li>
        ))}
      </ul>
    </section>
  )
}
