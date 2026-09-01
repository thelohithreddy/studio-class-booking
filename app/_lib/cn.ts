// app/_lib/cn.ts
// Minimal className joiner (no dependency). Falsy values drop out; later strings
// simply append — we rely on disciplined, non-conflicting class usage rather
// than a full tailwind-merge, keeping the bundle lean.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
