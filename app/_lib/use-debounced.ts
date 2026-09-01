// app/_lib/use-debounced.ts
'use client'

import { useEffect, useState } from 'react'

/** Returns `value` delayed by `delay` ms — for search inputs that drive queries. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
