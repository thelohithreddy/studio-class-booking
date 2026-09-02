// app/_lib/overlay-stack.ts
//
// A tiny module-level guard so a nested popup (the Combobox listbox) can absorb
// an Escape keypress before the surrounding Dialog/Drawer does. Without it, the
// document-level Escape handler in a modal would close the whole drawer — losing
// a half-filled form — when the user only meant to close the open picker.

let openPopups = 0

export const escGuard = {
  push() {
    openPopups += 1
  },
  pop() {
    openPopups = Math.max(0, openPopups - 1)
  },
  /** True while at least one nested popup is open and should own Escape. */
  blocked() {
    return openPopups > 0
  },
}
