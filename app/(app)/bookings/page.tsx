'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { keepPreviousData } from '@tanstack/react-query'

import { qk, useApiQuery } from '@app/_lib/query'
import { useDebouncedValue } from '@app/_lib/use-debounced'
import { formatDateTime } from '@app/_lib/format'
import { BOOKING_STATUS, BOOKING_STATUS_ORDER } from '@app/_lib/status'
import type { BookingListItem, BookingListResponse, ClassListResponse } from '@app/_lib/types'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  PageHeader,
  SearchInput,
  SelectInput,
  SkeletonRows,
  Spinner,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from '@app/_components/ui'
import { BookingCreateDrawer } from '@app/_components/booking-create'
import { IconBookings, IconPlus, IconSearch } from '@app/_components/icons'
import { useIsStaff } from '../_shell/user-context'

type SortField = 'bookedAt' | 'status' | 'session'

export default function BookingsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10">
          <Spinner />
        </div>
      }
    >
      <BookingsInner />
    </Suspense>
  )
}

function BookingsInner() {
  const staff = useIsStaff()
  const router = useRouter()
  const sp = useSearchParams()

  const q = sp.get('q') ?? ''
  const status = sp.get('status') ?? ''
  const classId = sp.get('classId') ?? ''
  const sort = (sp.get('sort') as SortField) || 'bookedAt'
  const dir = (sp.get('dir') as 'asc' | 'desc') || 'desc'
  const page = Math.max(1, Number(sp.get('page') ?? '1'))

  const [search, setSearch] = useState(q)
  const [creating, setCreating] = useState(false)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  function apply(next: Record<string, string | number | null>, resetPage = true) {
    const params = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, String(v))
    }
    if (resetPage && !('page' in next)) params.delete('page')
    router.replace(`/bookings${params.toString() ? `?${params.toString()}` : ''}`, {
      scroll: false,
    })
  }

  // Push the debounced search term into the URL (source of truth for the query).
  useEffect(() => {
    if (debouncedSearch !== q) apply({ q: debouncedSearch || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const params = new URLSearchParams({ page: String(page), pageSize: '20', sort, dir })
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  if (classId) params.set('classId', classId)
  const bookings = useApiQuery<BookingListResponse>(
    qk.bookings({ q, status, classId, sort, dir, page }),
    `/api/bookings?${params.toString()}`,
    // Keep the current page visible while the next page/filter/sort loads, so
    // the table doesn't collapse to a skeleton on every interaction.
    { placeholderData: keepPreviousData },
  )

  function toggleSort(field: SortField) {
    const nextDir = sort === field ? (dir === 'asc' ? 'desc' : 'asc') : 'desc'
    apply({ sort: field, dir: nextDir })
  }

  const hasFilters = Boolean(q || status || classId)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        description="Every booking across the sessions you can see. Search, filter, and settle attendance."
        actions={
          staff ? (
            <Button icon={<IconPlus className="size-4" />} onClick={() => setCreating(true)}>
              New booking
            </Button>
          ) : undefined
        }
      />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-64">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search member name or email…"
              aria-label="Search bookings"
            />
          </div>
          <SelectInput
            label="Status"
            value={status}
            onChange={(e) => apply({ status: e.target.value || null })}
            containerClassName="sm:w-44"
          >
            <option value="">All statuses</option>
            {BOOKING_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS[s].label}
              </option>
            ))}
          </SelectInput>
          {staff ? (
            <BookingClassFilter value={classId} onChange={(v) => apply({ classId: v || null })} />
          ) : null}
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              className="sm:mb-0.5"
              onClick={() => {
                setSearch('')
                router.replace('/bookings', { scroll: false })
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {bookings.isError ? (
          <ErrorState message={bookings.error.message} onRetry={() => void bookings.refetch()} />
        ) : bookings.isPending ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : bookings.data.bookings.length === 0 ? (
          <EmptyState
            icon={
              hasFilters ? <IconSearch className="size-5" /> : <IconBookings className="size-5" />
            }
            title={hasFilters ? 'No bookings match your filters' : 'No bookings yet'}
            description={
              hasFilters
                ? 'Try a different search term, status, or class — or clear the filters.'
                : staff
                  ? 'Create a booking to reserve a member’s spot in a session.'
                  : 'Bookings for your sessions will appear here.'
            }
            action={
              staff && !hasFilters ? (
                <Button onClick={() => setCreating(true)}>New booking</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <Th>Member</Th>
                  <Th
                    sortable
                    active={sort === 'session'}
                    direction={dir}
                    onSort={() => toggleSort('session')}
                  >
                    Session
                  </Th>
                  <Th
                    sortable
                    active={sort === 'bookedAt'}
                    direction={dir}
                    onSort={() => toggleSort('bookedAt')}
                  >
                    Booked
                  </Th>
                  <Th
                    sortable
                    active={sort === 'status'}
                    direction={dir}
                    onSort={() => toggleSort('status')}
                    align="right"
                  >
                    Status
                  </Th>
                </THead>
                <tbody>
                  {bookings.data.bookings.map((b) => (
                    <BookingTableRow
                      key={b.id}
                      booking={b}
                      onOpen={() => router.push(`/bookings/${b.id}`)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {bookings.data.bookings.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/bookings/${b.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-surface-2/60"
                  >
                    <Avatar name={b.member.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">{b.member.name}</p>
                      <p className="truncate text-xs text-muted">
                        {b.session.class.title} · {formatDateTime(b.session.startsAt)}
                      </p>
                    </div>
                    <StatusBadge meta={BOOKING_STATUS[b.status]} />
                  </Link>
                </li>
              ))}
            </ul>

            {bookings.isFetching ? (
              <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-xs text-subtle">
                <Spinner className="size-3.5" /> Updating…
              </div>
            ) : null}
            <Pagination
              page={bookings.data.page}
              pageSize={bookings.data.pageSize}
              total={bookings.data.total}
              onPageChange={(p) => apply({ page: p }, false)}
              className="border-t-0"
            />
          </>
        )}
      </Card>

      {staff ? <BookingCreateDrawer open={creating} onClose={() => setCreating(false)} /> : null}
    </div>
  )
}

function BookingClassFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const classes = useApiQuery<ClassListResponse>(
    qk.classes({ filter: true }),
    '/api/classes?pageSize=100',
  )
  return (
    <SelectInput
      label="Class"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      containerClassName="sm:w-52"
    >
      <option value="">All classes</option>
      {classes.data?.classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </SelectInput>
  )
}

function BookingTableRow({ booking, onOpen }: { booking: BookingListItem; onOpen: () => void }) {
  return (
    <Tr onClick={onOpen}>
      <Td>
        <div className="flex items-center gap-3">
          <Avatar name={booking.member.name} />
          <Link
            href={`/bookings/${booking.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-fg hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {booking.member.name}
          </Link>
        </div>
      </Td>
      <Td>
        <p className="font-medium text-fg">{booking.session.class.title}</p>
        <p className="text-xs text-muted">{formatDateTime(booking.session.startsAt)}</p>
      </Td>
      <Td className="whitespace-nowrap text-muted">{formatDateTime(booking.createdAt)}</Td>
      <Td align="right">
        <StatusBadge meta={BOOKING_STATUS[booking.status]} />
      </Td>
    </Tr>
  )
}
