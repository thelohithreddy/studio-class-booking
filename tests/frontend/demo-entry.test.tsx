// tests/frontend/demo-entry.test.tsx
//
// One-click evaluator entry: each button posts the right role to /api/auth/demo
// and routes to that role's home; a failure surfaces an error without redirect.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}))

import { DemoEntry } from '@app/_components/landing/demo-entry'

function mockFetch(ok: boolean, status = ok ? 204 : 404) {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok, status, json: async () => ({}) }) as unknown as typeof fetch
}

beforeEach(() => {
  replace.mockClear()
  refresh.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('DemoEntry', () => {
  it('signs in as staff and routes to the dashboard', async () => {
    mockFetch(true)
    const user = userEvent.setup()
    render(<DemoEntry />)
    await user.click(screen.getByRole('button', { name: /explore as staff/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/demo',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ role: 'STAFF' }) }),
    )
  })

  it('signs in as instructor and routes to sessions', async () => {
    mockFetch(true)
    const user = userEvent.setup()
    render(<DemoEntry />)
    await user.click(screen.getByRole('button', { name: /explore as instructor/i }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sessions'))
  })

  it('shows an error and does not redirect when demo access is unavailable', async () => {
    mockFetch(false, 404)
    const user = userEvent.setup()
    render(<DemoEntry />)
    await user.click(screen.getByRole('button', { name: /explore as staff/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i)
    expect(replace).not.toHaveBeenCalled()
  })
})
