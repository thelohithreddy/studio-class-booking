// app/_components/ui/form.tsx
'use client'

import { forwardRef, useId } from 'react'

import { cn } from '@app/_lib/cn'

/** Shared control surface — one look for every input, select, and combobox. */
export const controlClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg ' +
  'transition-[border-color,box-shadow] placeholder:text-subtle ' +
  'focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-ring/22 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-[color:var(--tone-danger)] ' +
  'aria-invalid:ring-[color:var(--tone-danger)]/20'

const fieldHeight = 'h-9'

function RequiredMark() {
  return (
    <span className="text-[color:var(--tone-danger)]" aria-hidden="true">
      {' '}
      *
    </span>
  )
}

interface FieldShellProps {
  id: string
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: React.ReactNode
}

/** Label + control + hint/error, wired with aria-describedby & required marking. */
function FieldShell({ id, label, hint, error, required, className, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg">
          {label}
          {required ? <RequiredMark /> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-[color:var(--tone-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}

interface CommonFieldProps {
  label?: string
  hint?: string
  error?: string | null
  containerClassName?: string
}

export interface TextInputProps
  extends CommonFieldProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, required, containerClassName, className, ...props },
  ref,
) {
  const id = useId()
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, fieldHeight, className)}
        {...props}
      />
    </FieldShell>
  )
})

export interface TextAreaProps
  extends CommonFieldProps, Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, required, containerClassName, className, rows = 3, ...props },
  ref,
) {
  const id = useId()
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, 'resize-y py-2 leading-relaxed', className)}
        {...props}
      />
    </FieldShell>
  )
})

export interface SelectInputProps
  extends CommonFieldProps, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { label, hint, error, required, containerClassName, className, children, ...props },
  ref,
) {
  const id = useId()
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            controlClass,
            fieldHeight,
            'cursor-pointer appearance-none pr-9',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </FieldShell>
  )
})

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode
  hint?: string
}

export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        className={cn(
          'mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong text-brand',
          'accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="cursor-pointer text-sm text-fg select-none">
        {label}
        {hint ? <span className="block text-xs text-subtle">{hint}</span> : null}
      </label>
    </div>
  )
}

/** A standalone search input with a leading magnifier — used above lists. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function SearchInput({ className, ...props }, ref) {
  return (
    <div className="relative">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="m14 14 3 3" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        className={cn(controlClass, fieldHeight, 'pl-9', className)}
        {...props}
      />
    </div>
  )
})
