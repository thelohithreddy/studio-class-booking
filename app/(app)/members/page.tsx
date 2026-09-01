'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { apiSend } from '@app/_lib/api'
import { qk, useApiMutation, useApiQuery } from '@app/_lib/query'
import { useDebouncedValue } from '@app/_lib/use-debounced'
import { formatMembershipDate, toDateInputValue } from '@app/_lib/format'
import { membershipFromExpiry } from '@app/_lib/status'
import type { Member, MemberListResponse, MemberResponse } from '@app/_lib/types'
import {
  AsyncBoundary,
  Avatar,
  Button,
  Callout,
  Card,
  Drawer,
  EmptyState,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonRows,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
  TextInput,
  useToast,
} from '@app/_components/ui'
import { IconMembers, IconPlus, IconSearch } from '@app/_components/icons'

type Editing = { mode: 'create' } | { mode: 'edit'; member: Member } | null

export default function MembersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      }
    >
      <MembersPageInner />
    </Suspense>
  )
}

function MembersPageInner() {
  const searchParams = useSearchParams()
  // Deep-link support: /members?q=… (e.g. from a membership alert) prefills search.
  const [rawQuery, setRawQuery] = useState(() => searchParams.get('q') ?? '')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Editing>(null)
  const q = useDebouncedValue(rawQuery.trim(), 300)

  const params = new URLSearchParams({ page: String(page), pageSize: '20' })
  if (q) params.set('q', q)
  const key = qk.members({ q, page })
  const members = useApiQuery<MemberListResponse>(key, `/api/members?${params.toString()}`)

  function onSearchChange(value: string) {
    setRawQuery(value)
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="Everyone who books into your sessions. Membership status controls whether they can make a new booking."
        actions={
          <Button
            icon={<IconPlus className="size-4" />}
            onClick={() => setEditing({ mode: 'create' })}
          >
            Add member
          </Button>
        }
      />

      <div className="max-w-sm">
        <SearchInput
          value={rawQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search members"
        />
      </div>

      <Card className="overflow-hidden">
        <AsyncBoundary
          query={members}
          skeleton={
            <div className="p-4">
              <SkeletonRows rows={6} />
            </div>
          }
          isEmpty={(d) => d.members.length === 0}
          empty={
            q ? (
              <EmptyState
                icon={<IconSearch className="size-5" />}
                title="No members match your search"
                description={`Nothing found for “${q}”. Try a different name or email.`}
              />
            ) : (
              <EmptyState
                icon={<IconMembers className="size-5" />}
                title="No members yet"
                description="Add the people who attend your classes. You’ll set a membership expiry date so lapsed members can’t book."
                action={
                  <Button
                    icon={<IconPlus className="size-4" />}
                    onClick={() => setEditing({ mode: 'create' })}
                  >
                    Add member
                  </Button>
                }
              />
            )
          }
        >
          {(data) => (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <THead>
                    <Th>Member</Th>
                    <Th>Membership</Th>
                    <Th align="right">Actions</Th>
                  </THead>
                  <tbody>
                    {data.members.map((member) => (
                      <Tr key={member.id}>
                        <Td>
                          <div className="flex items-center gap-3">
                            <Avatar name={member.name} />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-fg">{member.name}</p>
                              <p className="truncate text-xs text-muted">{member.email}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <MembershipCell expiresOn={member.membershipExpiresOn} />
                        </Td>
                        <Td align="right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ mode: 'edit', member })}
                          >
                            Edit
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              {/* Mobile card list */}
              <ul className="divide-y divide-line sm:hidden">
                {data.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 p-4">
                    <Avatar name={member.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{member.name}</p>
                      <p className="truncate text-xs text-muted">{member.email}</p>
                      <div className="mt-1.5">
                        <MembershipCell expiresOn={member.membershipExpiresOn} />
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing({ mode: 'edit', member })}
                    >
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>

              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </AsyncBoundary>
      </Card>

      <MemberDrawer editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function MembershipCell({ expiresOn }: { expiresOn: string }) {
  const meta = membershipFromExpiry(expiresOn)
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge meta={meta} />
      <span className="text-xs text-muted">
        {meta.state === 'expired' ? 'Expired' : 'Expires'} {formatMembershipDate(expiresOn)}
      </span>
    </div>
  )
}

function MemberDrawer({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const toast = useToast()
  const open = editing !== null
  const isEdit = editing?.mode === 'edit'

  const [form, setForm] = useState({ name: '', email: '', membershipExpiresOn: '' })
  const [lastKey, setLastKey] = useState<string | null>(null)
  const key = editing?.mode === 'edit' ? editing.member.id : (editing?.mode ?? null)
  if (open && key !== lastKey) {
    setLastKey(key)
    setForm(
      editing?.mode === 'edit'
        ? {
            name: editing.member.name,
            email: editing.member.email,
            membershipExpiresOn: toDateInputValue(editing.member.membershipExpiresOn),
          }
        : { name: '', email: '', membershipExpiresOn: '' },
    )
  }
  if (!open && lastKey !== null) setLastKey(null)

  const mutation = useApiMutation(
    (body: typeof form) =>
      isEdit
        ? apiSend<MemberResponse>(
            `/api/members/${(editing as { member: Member }).member.id}`,
            'PATCH',
            body,
          )
        : apiSend<MemberResponse>('/api/members', 'POST', body),
    {
      invalidate: [qk.members(), qk.alerts],
      onSuccess: () => {
        toast.success(isEdit ? 'Member updated' : 'Member added')
        onClose()
      },
    },
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    mutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      membershipExpiresOn: form.membershipExpiresOn,
    })
  }

  const preview = form.membershipExpiresOn ? membershipFromExpiry(form.membershipExpiresOn) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit member' : 'Add member'}
      description={
        isEdit ? undefined : 'Members must have a current membership to make new bookings.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="member-form" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Add member'}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} className="flex flex-col gap-4">
        {mutation.error ? (
          <Callout tone="danger" role="alert">
            {mutation.error.message}
          </Callout>
        ) : null}
        <TextInput
          label="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Jordan Lee"
          maxLength={200}
          required
          autoFocus
        />
        <TextInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="member@email.com"
          required
        />
        <TextInput
          label="Membership expires on"
          type="date"
          value={form.membershipExpiresOn}
          onChange={(e) => setForm({ ...form, membershipExpiresOn: e.target.value })}
          hint={
            preview
              ? `This membership is ${preview.label.toLowerCase()}.`
              : 'The last day this member’s access is valid.'
          }
          required
        />
      </form>
    </Drawer>
  )
}
