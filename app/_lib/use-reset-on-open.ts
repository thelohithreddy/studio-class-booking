// app/_lib/use-reset-on-open.ts
'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `reset` whenever `open` transitions false → true. Used to clear a
 * mutation's leftover error/result when a drawer or dialog is reopened, so a
 * previous failed submit never greets the user on a fresh open. `reset` is a
 * stable React Query mutation method, so this runs only on the open edge.
 */
export function useResetOnOpen(open: boolean, reset: () => void) {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true
      reset()
    } else if (!open) {
      wasOpen.current = false
    }
  }, [open, reset])
}
