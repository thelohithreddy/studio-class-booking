// app/_components/icons.tsx
// A small, consistent stroke-icon set (24×24, 1.7 stroke, rounded). Used across
// navigation, buttons, and empty states so iconography reads as one family.
import type { SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="6" rx="1.5" />
    <rect x="13.5" y="12" width="7.5" height="9" rx="1.5" />
  </Icon>
)
export const IconClasses = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 0 4 20.5Z" />
    <path d="M4 5.5A1.5 1.5 0 0 0 5.5 7H20" />
    <path d="M9 11h7M9 14.5h5" />
  </Icon>
)
export const IconSessions = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
    <path d="M3.5 9h17M8 3v3M16 3v3" />
    <path d="M12 12.5v3.5M10.25 14.25h3.5" />
  </Icon>
)
export const IconBookings = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
    <path d="M14.5 3.5V8H19" />
    <path d="M8 12.5l2.2 2.2L15 10.5" />
  </Icon>
)
export const IconMembers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 4.2a3.2 3.2 0 0 1 0 6.1M17.5 15c2.2.5 3.5 2.4 3.5 5" />
  </Icon>
)
export const IconRooms = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 20V6.5L12 3l8 3.5V20" />
    <path d="M3 20h18" />
    <rect x="9.5" y="13" width="5" height="7" />
    <path d="M8 8.5h.01M12 8.5h.01M16 8.5h.01" />
  </Icon>
)
export const IconAlerts = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 4a5.5 5.5 0 0 0-5.5 5.5c0 4.5-2 6-2 6h15s-2-1.5-2-6A5.5 5.5 0 0 0 12 4Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
)
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 21s6.5-5.5 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.5 6.5 11 6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
)
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.3 3-6 7-6s7 2.7 7 6" />
  </Icon>
)
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
    <path d="M4.5 18.5h15" />
  </Icon>
)
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 7h15M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M6.5 7l.8 12A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
)
export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" />
    <path d="M13.5 6.5l3 3" />
  </Icon>
)
export const IconArchive = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" />
    <path d="M10 12h4" />
  </Icon>
)
export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 9V7.5A2.5 2.5 0 0 1 6.5 5H17l-2.5-2.5M20 15v1.5a2.5 2.5 0 0 1-2.5 2.5H7l2.5 2.5" />
  </Icon>
)
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 4v16h16" />
    <path d="M8 15v2M12 11v6M16 7v10" />
  </Icon>
)
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m5 12 4.5 4.5L19 7" />
  </Icon>
)
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)
export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M15 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 19v-.5" />
    <path d="M10 12h10m0 0-3-3m3 3-3 3" />
  </Icon>
)
