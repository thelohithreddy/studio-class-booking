// app/_components/ui/combobox.tsx
'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@app/_lib/cn'
import { escGuard } from '@app/_lib/overlay-stack'
import { controlClass } from './form'
import { Spinner } from './feedback'

export interface ComboboxItem {
  value: string
  label: string
  /** Secondary line (e.g. email, class + time) shown under the label. */
  description?: string
  disabled?: boolean
}

/**
 * A searchable single-select (WAI-ARIA combobox + listbox). This is how the
 * product selects members, instructors, sessions and classes by NAME — a raw
 * UUID is never typed. Pass `onSearch` for server-side search (members,
 * sessions); omit it to filter the provided `items` locally (instructors,
 * classes, rooms). Pass `error` (+ optional `onRetry`) so a failed data fetch
 * reads as an error, not an empty list.
 */
export function Combobox({
  items,
  value,
  onChange,
  selectedItem,
  onSearch,
  loading = false,
  error = null,
  onRetry,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  disabled = false,
  invalid = false,
  ariaLabel,
}: {
  items: ComboboxItem[]
  value: string | null
  onChange: (value: string, item: ComboboxItem) => void
  /** The full item for the current value, so the trigger shows its label even
   *  when it isn't in the currently filtered list. */
  selectedItem?: ComboboxItem | null
  onSearch?: (term: string) => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  invalid?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  // The last item the user picked here, so its label survives the list changing
  // out from under it (server search) even before `selectedItem` catches up.
  const [picked, setPicked] = useState<ComboboxItem | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  // Resolve the label for the current value from the best source available.
  const resolved =
    (picked && picked.value === value && picked) ||
    (selectedItem && selectedItem.value === value && selectedItem) ||
    items.find((i) => i.value === value) ||
    null
  const currentLabel = resolved ? resolved.label : null

  const filtered = useMemo(() => {
    if (onSearch) return items // server already filtered
    const t = term.trim().toLowerCase()
    if (!t) return items
    return items.filter(
      (i) => i.label.toLowerCase().includes(t) || i.description?.toLowerCase().includes(t),
    )
  }, [items, term, onSearch])

  // While the popup is open it owns Escape (so it closes instead of the drawer).
  useEffect(() => {
    if (!open) return
    escGuard.push()
    return () => escGuard.pop()
  }, [open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Focus the search field when opening (no setState here — active is reset in
  // the open handler and on each keystroke).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  function toggleOpen() {
    setActive(0)
    setOpen((o) => !o)
  }

  function commit(item: ComboboxItem) {
    if (item.disabled) return
    setPicked(item)
    onChange(item.value, item)
    setOpen(false)
    setTerm('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = filtered[active]
      if (item) commit(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  const activeDescendant =
    open && !loading && !error && filtered[active] ? optionId(active) : undefined

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={toggleOpen}
        className={cn(
          controlClass,
          'flex h-9 items-center justify-between gap-2 text-left',
          !currentLabel && 'text-subtle',
        )}
      >
        <span className="truncate">{currentLabel ?? placeholder}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-4 shrink-0 text-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="anim-pop-in absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              type="text"
              value={term}
              placeholder={searchPlaceholder}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendant}
              aria-label={ariaLabel ? `Search ${ariaLabel.toLowerCase()}` : 'Search'}
              onChange={(e) => {
                setTerm(e.target.value)
                setActive(0)
                onSearch?.(e.target.value)
              }}
              onKeyDown={onKeyDown}
              className={cn(controlClass, 'h-8')}
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <li className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-muted">
                <Spinner className="size-4" /> Searching…
              </li>
            ) : error ? (
              <li className="flex flex-col items-center gap-2 px-3 py-4 text-center text-sm">
                <span className="text-[color:var(--tone-danger)]">{error}</span>
                {onRetry ? (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Try again
                  </button>
                ) : null}
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-muted">{emptyText}</li>
            ) : (
              filtered.map((item, i) => {
                const selected = item.value === value
                const isActive = i === active
                return (
                  <li key={item.value} id={optionId(i)} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={item.disabled}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(item)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50',
                        isActive ? 'bg-surface-2' : 'bg-transparent',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-fg">{item.label}</span>
                        {item.description ? (
                          <span className="block truncate text-xs text-muted">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      {selected ? (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="size-4 shrink-0 text-brand"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            d="m5 10 3.5 3.5L15 6.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
