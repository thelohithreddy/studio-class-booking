// tests/frontend/login.test.tsx
//
// The sign-in journey: a 204 success routes to the dashboard; failures map to
// the right user-facing copy without leaking whether the account exists.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}))

import LoginPage from '@app/(auth)/login/page'

function mockFetch(status: number, ok = status >= 200 && status < 300) {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok, status, json: async () => ({}) }) as unknown as typeof fetch
}

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'a@b.com')
  await user.type(screen.getByLabelText(/password/i), 'secret123')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

beforeEach(() => {
  replace.mockClear()
  refresh.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('LoginPage', () => {
  it('routes to the dashboard on a 204 success', async () => {
    mockFetch(204)
    render(<LoginPage />)
    await fillAndSubmit()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('shows a generic credentials error on 401 (no account enumeration)', async () => {
    mockFetch(401)
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/don’t match|dont match|match/i)
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows a rate-limit message on 429', async () => {
    mockFetch(429)
    render(<LoginPage />)
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
  })
})
