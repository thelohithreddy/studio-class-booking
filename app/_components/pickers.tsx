// app/_components/pickers.tsx
'use client'

import { useState } from 'react'

import { qk, useApiQuery } from '@app/_lib/query'
import { useDebouncedValue } from '@app/_lib/use-debounced'
import { formatDateTime } from '@app/_lib/format'
import { sessionFill } from '@app/_lib/status'
import type {
  ClassListResponse,
  InstructorListResponse,
  MemberListResponse,
  RoomListResponse,
  SessionListResponse,
} from '@app/_lib/types'
import { Combobox, type ComboboxItem } from '@app/_components/ui'

interface PickerProps {
  value: string | null
  /** item carries the human-readable label of the choice (for result summaries). */
  onChange: (value: string, item: ComboboxItem) => void
  invalid?: boolean
  selectedItem?: ComboboxItem | null
}

/** Choose a session's primary or co-instructor by name (never UUID). */
export function InstructorPicker({ value, onChange, invalid, selectedItem }: PickerProps) {
  const q = useApiQuery<InstructorListResponse>(qk.instructors, '/api/instructors')
  const items: ComboboxItem[] = (q.data?.instructors ?? []).map((i) => ({
    value: i.id,
    label: i.name,
    description: i.email,
  }))
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      loading={q.isPending}
      selectedItem={selectedItem}
      placeholder="Select an instructor"
      searchPlaceholder="Search instructors…"
      emptyText="No instructors found"
      ariaLabel="Instructor"
      invalid={invalid}
    />
  )
}

/** Choose a room by name. */
export function RoomPicker({ value, onChange, invalid, selectedItem }: PickerProps) {
  const q = useApiQuery<RoomListResponse>(qk.rooms, '/api/rooms')
  const items: ComboboxItem[] = (q.data?.rooms ?? []).map((r) => ({ value: r.id, label: r.name }))
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      loading={q.isPending}
      selectedItem={selectedItem}
      placeholder="Select a room"
      searchPlaceholder="Search rooms…"
      emptyText="No rooms found"
      ariaLabel="Room"
      invalid={invalid}
    />
  )
}

/** Choose an active class by title. */
export function ClassPicker({ value, onChange, invalid, selectedItem }: PickerProps) {
  const q = useApiQuery<ClassListResponse>(
    qk.classes({ picker: true }),
    '/api/classes?pageSize=100',
  )
  const items: ComboboxItem[] = (q.data?.classes ?? []).map((c) => ({
    value: c.id,
    label: c.title,
    description: c.discipline,
  }))
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      loading={q.isPending}
      selectedItem={selectedItem}
      placeholder="Select a class"
      searchPlaceholder="Search classes…"
      emptyText="No classes found"
      ariaLabel="Class"
      invalid={invalid}
    />
  )
}

/** Choose a member by name/email, searched on the server. */
export function MemberPicker({ value, onChange, invalid, selectedItem }: PickerProps) {
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term.trim(), 300)
  const params = new URLSearchParams({ pageSize: '10' })
  if (debounced) params.set('q', debounced)
  const q = useApiQuery<MemberListResponse>(
    qk.members({ picker: true, q: debounced }),
    `/api/members?${params.toString()}`,
  )
  const items: ComboboxItem[] = (q.data?.members ?? []).map((m) => ({
    value: m.id,
    label: m.name,
    description: m.email,
  }))
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      onSearch={setTerm}
      loading={q.isFetching}
      selectedItem={selectedItem}
      placeholder="Select a member"
      searchPlaceholder="Search by name or email…"
      emptyText="No members found"
      ariaLabel="Member"
      invalid={invalid}
    />
  )
}

/**
 * Choose a session, filtered locally by class/room/time. The sessions API has
 * no text search (its `q` is ignored), so we load the upcoming window (from
 * today) and let the combobox filter the labels — plenty for a studio's
 * schedule, and it shows each session's booking pressure inline.
 */
export function SessionPicker({ value, onChange, invalid, selectedItem }: PickerProps) {
  // Anchor "upcoming" to mount time (kept out of the render body for purity).
  const [from] = useState(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`
  })
  const q = useApiQuery<SessionListResponse>(
    qk.sessions({ picker: true, from }),
    `/api/sessions?pageSize=100&from=${from}`,
  )
  const items: ComboboxItem[] = (q.data?.sessions ?? []).map((s) => {
    const fill = sessionFill(s.bookedCount, s.capacity)
    return {
      value: s.id,
      label: `${s.class.title} · ${formatDateTime(s.startsAt)}`,
      description: `${s.room.name} · ${s.bookedCount}/${s.capacity} booked${fill.isFull ? ' · full → waitlist' : ''}`,
    }
  })
  return (
    <Combobox
      items={items}
      value={value}
      onChange={onChange}
      loading={q.isPending}
      selectedItem={selectedItem}
      placeholder="Select a session"
      searchPlaceholder="Filter by class, room or time…"
      emptyText="No upcoming sessions"
      ariaLabel="Session"
      invalid={invalid}
    />
  )
}
