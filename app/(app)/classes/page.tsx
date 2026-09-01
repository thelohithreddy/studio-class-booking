'use client'

import { useState } from 'react'
import Link from 'next/link'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { useDebouncedValue } from '@app/_lib/use-debounced'
import { formatDuration, pluralize } from '@app/_lib/format'
import { classState } from '@app/_lib/status'
import type { ClassDTO, ClassListResponse, ClassResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Button,
  Card,
  Checkbox,
  EmptyState,
  LinkButton,
  Pagination,
  PageHeader,
  Pill,
  SearchInput,
  SkeletonRows,
  StatusBadge,
  useConfirm,
  useToast,
} from '@app/_components/ui'
import { IconArchive, IconClasses, IconEdit, IconPlus, IconSearch } from '@app/_components/icons'
import { ClassFormDrawer } from '@app/_components/class-form'

type Editing = { mode: 'create' } | { mode: 'edit'; cls: ClassDTO } | null

export default function ClassesPage() {
  const [rawQuery, setRawQuery] = useState('')
  const [page, setPage] = useState(1)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const q = useDebouncedValue(rawQuery.trim(), 300)

  const params = new URLSearchParams({ page: String(page), pageSize: '12' })
  if (q) params.set('q', q)
  if (showArchived) params.set('includeArchived', 'true')
  const classes = useApiQuery<ClassListResponse>(
    qk.classes({ q, page, showArchived }),
    `/api/classes?${params.toString()}`,
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Classes"
        description="The templates your sessions are scheduled from — each carries a default duration and capacity."
        actions={
          <Button
            icon={<IconPlus className="size-4" />}
            onClick={() => setEditing({ mode: 'create' })}
          >
            New class
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-full max-w-sm">
          <SearchInput
            value={rawQuery}
            onChange={(e) => {
              setRawQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Search by title or discipline…"
            aria-label="Search classes"
          />
        </div>
        <Checkbox
          label="Show archived"
          checked={showArchived}
          onChange={(e) => {
            setShowArchived(e.target.checked)
            setPage(1)
          }}
        />
      </div>

      <AsyncBoundary
        query={classes}
        skeleton={
          <div className="grid gap-3 sm:grid-cols-2">
            <SkeletonRows rows={6} />
          </div>
        }
        isEmpty={(d) => d.classes.length === 0}
        empty={
          q ? (
            <Card>
              <EmptyState
                icon={<IconSearch className="size-5" />}
                title="No classes match your search"
                description={`Nothing found for “${q}”.`}
              />
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<IconClasses className="size-5" />}
                title="No classes yet"
                description="Create your first class — a title, discipline, and the defaults each session inherits. You’ll schedule sessions from it next."
                action={
                  <Button
                    icon={<IconPlus className="size-4" />}
                    onClick={() => setEditing({ mode: 'create' })}
                  >
                    New class
                  </Button>
                }
              />
            </Card>
          )
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.classes.map((cls) => (
                <ClassCard
                  key={cls.id}
                  cls={cls}
                  onEdit={() => setEditing({ mode: 'edit', cls })}
                />
              ))}
            </div>
            {data.total > data.pageSize ? (
              <Card>
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onPageChange={setPage}
                />
              </Card>
            ) : null}
          </div>
        )}
      </AsyncBoundary>

      <ClassFormDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        cls={editing?.mode === 'edit' ? editing.cls : null}
      />
    </div>
  )
}

function ClassCard({ cls, onEdit }: { cls: ClassDTO; onEdit: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const archived = cls.archivedAt !== null

  const archiveToggle = useApiMutation(
    () =>
      apiSend<ClassResponse>(`/api/classes/${cls.id}/${archived ? 'restore' : 'archive'}`, 'POST'),
    {
      invalidate: [qk.classes(), qk.class(cls.id)],
      onSuccess: () => toast.success(archived ? 'Class restored' : 'Class archived'),
      onError: (e) => toast.error('Could not update class', e.message),
    },
  )

  async function toggleArchive() {
    if (!archived) {
      const ok = await confirm({
        title: `Archive “${cls.title}”?`,
        description:
          'It will be hidden from default views. Existing sessions and bookings are kept, and you can restore it anytime.',
        confirmLabel: 'Archive class',
      })
      if (!ok) return
    }
    archiveToggle.mutate()
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/classes/${cls.id}`}
            className="truncate text-base font-semibold text-fg hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {cls.title}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>{cls.discipline}</Pill>
            <span className="text-xs text-muted">
              {formatDuration(cls.defaultDurationMinutes)} ·{' '}
              {pluralize(cls.defaultCapacity, 'spot')}
            </span>
          </div>
        </div>
        <StatusBadge meta={classState(cls.archivedAt)} />
      </div>

      {cls.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted">{cls.description}</p>
      ) : null}

      <div className="mt-4 flex items-center gap-1 border-t border-line pt-3">
        <LinkButton href={`/classes/${cls.id}`} variant="subtle" size="sm">
          Open
        </LinkButton>
        <Button variant="ghost" size="sm" icon={<IconEdit className="size-4" />} onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconArchive className="size-4" />}
          onClick={toggleArchive}
          loading={archiveToggle.isPending}
          className="ml-auto"
        >
          {archived ? 'Restore' : 'Archive'}
        </Button>
      </div>
    </Card>
  )
}
