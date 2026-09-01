// app/_lib/api.ts
//
// The single client-side gateway to our same-origin JSON API. Every request the
// browser makes goes through here so error handling, the JSON envelope, and the
// no-body (204) cases are decoded in exactly one place. The server already
// returns human-readable messages inside { error: { code, message } }, so we
// carry that message straight through to the UI rather than inventing our own.

export interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

/** A failed API call, normalized. `status` 0 means the network never answered. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const NETWORK_MESSAGE = 'Could not reach the server — check your connection and try again.'
const SERVER_MESSAGE = 'Something went wrong on our end. Please try again.'

/**
 * Fetch JSON from the API. Resolves with the parsed body (or `undefined` for a
 * 204). Rejects with an ApiError carrying the server's own message on any
 * non-2xx, or a network ApiError(0) when the request never completes.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'network', NETWORK_MESSAGE)
  }

  if (res.status === 204) return undefined as T

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    const code = body?.error?.code ?? 'error'
    const message =
      body?.error?.message ??
      (res.status >= 500 ? SERVER_MESSAGE : `Request failed (${res.status}).`)
    throw new ApiError(res.status, code, message)
  }

  return (await res.json().catch(() => undefined)) as T
}

/** GET helper. */
export const apiGet = <T>(path: string): Promise<T> => apiFetch<T>(path)

/** Mutating helper: serializes `body` and sets the method. */
export const apiSend = <T>(path: string, method: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/**
 * Download a server-generated file (the attendance CSV) with real error
 * handling. We fetch it as a blob rather than pointing the browser at the URL,
 * so a 403/404/413 surfaces as a caught ApiError (a toast) instead of navigating
 * the user to a raw JSON error page. The file itself is generated entirely on
 * the server; the browser only saves the bytes.
 */
export async function downloadFile(path: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path, { headers: { accept: 'text/csv' } })
  } catch {
    throw new ApiError(0, 'network', NETWORK_MESSAGE)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'error',
      body?.error?.message ?? `Download failed (${res.status}).`,
    )
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const filename = match?.[1] ?? 'download.csv'

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
