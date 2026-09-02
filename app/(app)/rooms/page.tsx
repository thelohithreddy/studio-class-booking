'use client'

import { useState } from 'react'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { formatDate } from '@app/_lib/format'
import { useResetOnOpen } from '@app/_lib/use-reset-on-open'
import type { RoomListResponse, Room, RoomResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Button,
  Card,
  Drawer,
  EmptyState,
  PageHeader,
  SkeletonRows,
  TextInput,
  useToast,
} from '@app/_components/ui'
import { IconEdit, IconPlus, IconRooms } from '@app/_components/icons'

type Editing = { mode: 'create' } | { mode: 'edit'; room: Room } | null

export default function RoomsPage() {
  const rooms = useApiQuery<RoomListResponse>(qk.rooms, '/api/rooms')
  const [editing, setEditing] = useState<Editing>(null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rooms"
        description="The spaces sessions are scheduled into. Room names must be unique — they anchor double-booking checks."
        actions={
          <Button
            icon={<IconPlus className="size-4" />}
            onClick={() => setEditing({ mode: 'create' })}
          >
            New room
          </Button>
        }
      />

      <AsyncBoundary
        query={rooms}
        skeleton={<SkeletonRows rows={4} />}
        isEmpty={(d) => d.rooms.length === 0}
        empty={
          <Card>
            <EmptyState
              icon={<IconRooms className="size-5" />}
              title="No rooms yet"
              description="Add the spaces your studio runs classes in — a studio, a hall, a court. Sessions are scheduled into a room."
              action={
                <Button
                  icon={<IconPlus className="size-4" />}
                  onClick={() => setEditing({ mode: 'create' })}
                >
                  New room
                </Button>
              }
            />
          </Card>
        }
      >
        {(data) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.rooms.map((room) => (
              <Card key={room.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <IconRooms className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{room.name}</p>
                    <p className="text-xs text-subtle">Added {formatDate(room.createdAt)}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconEdit className="size-4" />}
                  onClick={() => setEditing({ mode: 'edit', room })}
                >
                  Rename
                </Button>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>

      <RoomDrawer editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function RoomDrawer({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const toast = useToast()
  const open = editing !== null
  const isEdit = editing?.mode === 'edit'
  const [name, setName] = useState('')

  // Sync field to whichever room we're editing whenever the drawer opens.
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = editing?.mode === 'edit' ? editing.room.id : (editing?.mode ?? null)
  if (open && key !== lastKey) {
    setLastKey(key)
    setName(editing?.mode === 'edit' ? editing.room.name : '')
  }
  if (!open && lastKey !== null) setLastKey(null)

  const mutation = useApiMutation(
    (value: string) =>
      isEdit
        ? apiSend<RoomResponse>(`/api/rooms/${(editing as { room: Room }).room.id}`, 'PATCH', {
            name: value,
          })
        : apiSend<RoomResponse>('/api/rooms', 'POST', { name: value }),
    {
      invalidate: [qk.rooms],
      onSuccess: () => {
        toast.success(isEdit ? 'Room renamed' : 'Room created')
        onClose()
      },
    },
  )
  useResetOnOpen(open, mutation.reset)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    mutation.mutate(trimmed)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Rename room' : 'New room'}
      description={isEdit ? undefined : 'Give the space a clear, unique name.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="room-form" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create room'}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} className="flex flex-col gap-4">
        <TextInput
          label="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Studio A"
          maxLength={120}
          required
          autoFocus
          error={mutation.error?.message ?? null}
        />
      </form>
    </Drawer>
  )
}
