// tests/frontend/signup.test.tsx
//
// The controlled-onboarding page. Cadence has no public sign-up (both roles are
// privileged and studio-provisioned), so this page must (a) NEVER render a
// credential-collecting form, (b) offer the real paths — demo when enabled, and
// always a Sign in link — and (c) bounce an already-authenticated visitor to
// their role home rather than showing an onboarding dead end.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Hoisted alongside the vi.mock factories (which are lifted to the top of the
// module) so these fns exist when the factories run.
const { redirect, currentUser, demoLoginEnabled } = vi.hoisted(() => ({
  redirect: vi.fn(),
  currentUser: vi.fn(),
  demoLoginEnabled: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/server/auth/current-user', () => ({ currentUser }))
vi.mock('@/server/auth/demo', () => ({ demoLoginEnabled }))

import SignupPage from '@app/(auth)/signup/page'

async function renderPage() {
  const ui = await SignupPage()
  render(ui)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('SignupPage (controlled onboarding)', () => {
  it('never renders a credential-collecting sign-up form', async () => {
    currentUser.mockResolvedValue(null)
    demoLoginEnabled.mockReturnValue(true)
    await renderPage()
    // No password or email fields — a public form could only mint a privileged
    // account, which would be a security regression.
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(document.querySelector('input[type="email"]')).toBeNull()
    expect(document.querySelector('form')).toBeNull()
  })

  it('offers demo entry and Sign in when demo is enabled', async () => {
    currentUser.mockResolvedValue(null)
    demoLoginEnabled.mockReturnValue(true)
    await renderPage()
    expect(screen.getByRole('button', { name: /explore as staff/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /explore as instructor/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('explains provisioning with a Sign in path when demo is disabled', async () => {
    currentUser.mockResolvedValue(null)
    demoLoginEnabled.mockReturnValue(false)
    await renderPage()
    expect(screen.queryByRole('button', { name: /explore as/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/provisioned by your studio administrator/i)).toBeInTheDocument()
  })

  it('redirects an already-authenticated visitor to their role home', async () => {
    currentUser.mockResolvedValue({ role: 'INSTRUCTOR' })
    demoLoginEnabled.mockReturnValue(true)
    await renderPage()
    expect(redirect).toHaveBeenCalledWith('/sessions')
  })
})
