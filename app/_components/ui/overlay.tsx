// app/_components/ui/overlay.tsx
'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@app/_lib/cn'
import { useIsClient } from '@app/_lib/use-is-client'
import { IconButton } from './button'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Shared modal behavior for Dialog & Drawer: lock body scroll, move focus into
 * the panel, trap Tab inside it, close on Escape, and return focus to the
 * trigger on close. Everything a real modal owes a keyboard/AT user.
 */
function useDialogA11y(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
) {
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const firstNode = nodes[0]!
      const lastNode = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      restore.current?.focus?.()
    }
  }, [open, onClose, panelRef])
}

type DialogSize = 'sm' | 'md' | 'lg' | 'xl'
const dialogWidth: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

function Header({
  titleId,
  descId,
  title,
  description,
  onClose,
}: {
  titleId: string
  descId: string
  title?: React.ReactNode
  description?: React.ReactNode
  onClose: () => void
}) {
  if (!title && !description) return null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        {title ? (
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p id={descId} className="mt-1 text-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <IconButton label="Close" size="sm" onClick={onClose} className="-mt-1 -mr-1 shrink-0">
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
        </svg>
      </IconButton>
    </div>
  )
}

/** Centered modal dialog. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: OverlayProps & { size?: DialogSize }) {
  const mounted = useIsClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useDialogA11y(open, onClose, panelRef)

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="anim-overlay-in absolute inset-0 bg-[var(--overlay)] backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'anim-dialog-in relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-lg outline-none sm:rounded-2xl',
          dialogWidth[size],
        )}
      >
        <Header
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/40 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

type DrawerSize = 'sm' | 'md' | 'lg'
const drawerWidth: Record<DrawerSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
}

/** Right-side drawer — for create/edit forms and detail panels. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: OverlayProps & { size?: DrawerSize }) {
  const mounted = useIsClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useDialogA11y(open, onClose, panelRef)

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="anim-overlay-in absolute inset-0 bg-[var(--overlay)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'anim-drawer-in relative z-10 flex h-full w-full flex-col overflow-hidden border-l border-line bg-surface shadow-lg outline-none',
          drawerWidth[size],
        )}
      >
        <Header
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/40 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
