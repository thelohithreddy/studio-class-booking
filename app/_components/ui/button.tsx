// app/_components/ui/button.tsx
'use client'

import { forwardRef } from 'react'
import Link from 'next/link'

import { cn } from '@app/_lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
  'transition-[background,border-color,box-shadow,transform,color] duration-100 select-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
  'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985]'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg shadow-xs hover:bg-brand-hover',
  secondary:
    'bg-surface text-fg border border-line-strong hover:bg-surface-2 hover:border-line-strong',
  subtle: 'bg-surface-2 text-fg hover:bg-surface-3',
  ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-[var(--danger-solid)] text-white shadow-xs hover:bg-[var(--danger-solid-hover)]',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[0.8125rem]',
  md: 'h-9 px-3.5 text-[0.875rem]',
  lg: 'h-11 px-5 text-[0.9375rem]',
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
    />
  )
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Optional icon element rendered before the label. */
  icon?: React.ReactNode
}

/**
 * The one button. Primary = the page's single most important action; secondary
 * and subtle recede; danger is reserved for destructive intent. `loading`
 * disables and swaps a spinner in while preserving width to avoid layout shift.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
})

export interface LinkButtonProps extends React.ComponentProps<typeof Link> {
  variant?: Variant
  size?: Size
  icon?: React.ReactNode
}

/** A link styled as a button — for navigation that looks like an action. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </Link>
  )
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Required — the accessible name for an icon-only control. */
  label: string
}

/** Square, icon-only button. `label` becomes aria-label + tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, className, children, disabled, ...props },
  ref,
) {
  const square = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-11' : 'size-9'
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(base, variants[variant], square, 'px-0', className)}
      {...props}
    >
      {children}
    </button>
  )
})
