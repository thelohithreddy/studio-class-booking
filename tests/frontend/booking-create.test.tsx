// tests/frontend/booking-create.test.tsx
//
// The core product journey: pick a member and a full session by NAME, submit,
// and see the WAITLISTED outcome communicated clearly (not a plain "success").
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BookingCreateDrawer } from '@app/_components/booking-create'

function jsonRes(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    headers: { get: () => null },
  } as unknown as Response
}

function installFetch(bookingStatus: 'BOOKED' | 'WAITLISTED') {
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u === '/api/bookings' && init?.method === 'POST') {
      return jsonRes(
        {
          booking: {
            id: 'b1',
            seq: 1,
            sessionId: 's1',
            memberId: 'm1',
            status: bookingStatus,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        201,
      )
    }
    if (u.startsWith('/api/members')) {
      return jsonRes({
        members: [
          {
            id: 'm1',
            name: 'Alice Ng',
            email: 'alice@studio.com',
            membershipExpiresOn: '2099-01-01T00:00:00.000Z',
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      })
    }
    if (u.startsWith('/api/sessions')) {
      return jsonRes({
        sessions: [
          {
            id: 's1',
            classId: 'c1',
            startsAt: '2099-01-01T18:00:00.000Z',
            endsAt: '2099-01-01T19:00:00.000Z',
            capacity: 10,
            bookedCount: 10, // full → next booking waitlists
            roomId: 'r1',
            primaryInstructorId: 'i1',
            class: { title: 'Vinyasa Flow', discipline: 'Yoga' },
            room: { name: 'Studio A' },
            primaryInstructor: { id: 'i1', name: 'Ivy' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    }
    return jsonRes({}, 200)
  }) as unknown as typeof fetch
}

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BookingCreateDrawer open onClose={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('BookingCreateDrawer', () => {
  it('books a member into a full session and shows the waitlist outcome', async () => {
    installFetch('WAITLISTED')
    const user = userEvent.setup()
    renderDrawer()

    // Pick the member by name.
    await user.click(screen.getByRole('combobox', { name: 'Member' }))
    await user.click(await screen.findByRole('button', { name: /Alice Ng/ }))

    // Pick the (full) session by name.
    await user.click(screen.getByRole('combobox', { name: 'Session' }))
    await user.click(await screen.findByRole('button', { name: /Vinyasa Flow/ }))

    await user.click(screen.getByRole('button', { name: /create booking/i }))

    const alert = await screen.findByText(/added to the waitlist/i)
    expect(alert).toBeInTheDocument()
    expect(screen.getByText(/not a confirmed spot/i)).toBeInTheDocument()

    // The POST carried exactly the member + session the user picked by name.
    const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => url === '/api/bookings' && init?.method === 'POST',
    )
    expect(postCall).toBeTruthy()
    expect(JSON.parse(postCall![1].body)).toMatchObject({ memberId: 'm1', sessionId: 's1' })
  })

  it('shows the server error and NO success state when the booking is rejected', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/bookings' && init?.method === 'POST') {
        return jsonRes(
          {
            error: { code: 'membership_expired', message: 'This member’s membership has expired.' },
          },
          422,
        )
      }
      if (u.startsWith('/api/members')) {
        return jsonRes({
          members: [{ id: 'm1', name: 'Alice Ng', email: 'alice@studio.com' }],
          total: 1,
          page: 1,
          pageSize: 10,
        })
      }
      return jsonRes({
        sessions: [
          {
            id: 's1',
            classId: 'c1',
            startsAt: '2099-01-01T18:00:00.000Z',
            endsAt: '2099-01-01T19:00:00.000Z',
            capacity: 10,
            bookedCount: 2,
            roomId: 'r1',
            primaryInstructorId: 'i1',
            class: { title: 'Vinyasa Flow', discipline: 'Yoga' },
            room: { name: 'Studio A' },
            primaryInstructor: { id: 'i1', name: 'Ivy' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByRole('combobox', { name: 'Member' }))
    await user.click(await screen.findByRole('button', { name: /Alice Ng/ }))
    await user.click(screen.getByRole('combobox', { name: 'Session' }))
    await user.click(await screen.findByRole('button', { name: /Vinyasa Flow/ }))
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    expect(await screen.findByText(/membership has expired/i)).toBeInTheDocument()
    // Critically, no false-success panel is shown.
    expect(screen.queryByText(/spot confirmed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/added to the waitlist/i)).not.toBeInTheDocument()
  })

  it('shows a confirmed-spot outcome when the server books directly', async () => {
    installFetch('BOOKED')
    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByRole('combobox', { name: 'Member' }))
    await user.click(await screen.findByRole('button', { name: /Alice Ng/ }))
    await user.click(screen.getByRole('combobox', { name: 'Session' }))
    await user.click(await screen.findByRole('button', { name: /Vinyasa Flow/ }))
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    expect(await screen.findByText(/spot confirmed/i)).toBeInTheDocument()
  })
})
