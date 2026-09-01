// app/_components/class-form.tsx
'use client'

import { useState } from 'react'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation } from '@app/_lib/query'
import { formatDuration } from '@app/_lib/format'
import type { ClassDTO, ClassResponse } from '@app/_lib/types'
import { Button, Callout, Drawer, TextArea, TextInput, useToast } from '@app/_components/ui'

const EMPTY = {
  title: '',
  discipline: '',
  description: '',
  defaultDurationMinutes: '60',
  defaultCapacity: '12',
}

/** Create (cls omitted) or edit a class. Shared by the list and detail pages. */
export function ClassFormDrawer({
  open,
  onClose,
  cls,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  cls?: ClassDTO | null
  onSaved?: () => void
}) {
  const toast = useToast()
  const isEdit = Boolean(cls)

  const [form, setForm] = useState(EMPTY)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = cls ? cls.id : open ? 'create' : null
  if (open && key !== lastKey) {
    setLastKey(key)
    setForm(
      cls
        ? {
            title: cls.title,
            discipline: cls.discipline,
            description: cls.description,
            defaultDurationMinutes: String(cls.defaultDurationMinutes),
            defaultCapacity: String(cls.defaultCapacity),
          }
        : EMPTY,
    )
  }
  if (!open && lastKey !== null) setLastKey(null)

  const mutation = useApiMutation(
    () => {
      const body = {
        title: form.title.trim(),
        discipline: form.discipline.trim(),
        description: form.description,
        defaultDurationMinutes: Number(form.defaultDurationMinutes),
        defaultCapacity: Number(form.defaultCapacity),
      }
      return cls
        ? apiSend<ClassResponse>(`/api/classes/${cls.id}`, 'PATCH', body)
        : apiSend<ClassResponse>('/api/classes', 'POST', body)
    },
    {
      invalidate: [qk.classes(), ...(cls ? [qk.class(cls.id)] : [])],
      onSuccess: () => {
        toast.success(isEdit ? 'Class updated' : 'Class created')
        onSaved?.()
        onClose()
      },
    },
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit class' : 'New class'}
      description={
        isEdit ? undefined : 'Sessions inherit these defaults but can override them individually.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="class-form" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create class'}
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
        className="flex flex-col gap-4"
      >
        {mutation.error ? (
          <Callout tone="danger" role="alert">
            {mutation.error.message}
          </Callout>
        ) : null}
        <TextInput
          label="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Vinyasa Flow"
          maxLength={200}
          required
          autoFocus
        />
        <TextInput
          label="Discipline"
          value={form.discipline}
          onChange={(e) => setForm({ ...form, discipline: e.target.value })}
          placeholder="e.g. Yoga"
          maxLength={80}
          required
        />
        <TextArea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What this class is about (optional)."
          maxLength={2000}
          rows={3}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Default duration"
            type="number"
            min={1}
            max={1440}
            value={form.defaultDurationMinutes}
            onChange={(e) => setForm({ ...form, defaultDurationMinutes: e.target.value })}
            hint={`Minutes (${formatDuration(Number(form.defaultDurationMinutes) || 0)})`}
            required
          />
          <TextInput
            label="Default capacity"
            type="number"
            min={0}
            max={100000}
            value={form.defaultCapacity}
            onChange={(e) => setForm({ ...form, defaultCapacity: e.target.value })}
            hint="Max participants"
            required
          />
        </div>
      </form>
    </Drawer>
  )
}
