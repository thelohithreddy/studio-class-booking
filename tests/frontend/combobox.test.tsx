// tests/frontend/combobox.test.tsx
//
// The searchable single-select that replaces raw-UUID entry across the app.
// Verifies it opens, filters by name, and reports the chosen VALUE + item.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboboxItem } from '@app/_components/ui/combobox'

const items: ComboboxItem[] = [
  { value: 'm1', label: 'Alice Ng', description: 'alice@studio.com' },
  { value: 'm2', label: 'Bob Ray', description: 'bob@studio.com' },
]

describe('Combobox', () => {
  it('shows the placeholder until a value is chosen', () => {
    render(
      <Combobox
        items={items}
        value={null}
        onChange={() => {}}
        placeholder="Select a member"
        ariaLabel="Member"
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Member' })).toHaveTextContent('Select a member')
  })

  it('opens, filters by typed text, and selects by name', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Combobox
        items={items}
        value={null}
        onChange={onChange}
        placeholder="Select a member"
        ariaLabel="Member"
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Member' }))
    expect(screen.getByRole('option', { name: /Alice Ng/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bob Ray/ })).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search/i), 'bob')
    expect(screen.queryByRole('option', { name: /Alice Ng/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Bob Ray/ }))
    expect(onChange).toHaveBeenCalledWith(
      'm2',
      expect.objectContaining({ value: 'm2', label: 'Bob Ray' }),
    )
  })

  it('renders the selected label for the current value', () => {
    render(<Combobox items={items} value="m1" onChange={() => {}} ariaLabel="Member" />)
    expect(screen.getByRole('combobox', { name: 'Member' })).toHaveTextContent('Alice Ng')
  })
})
