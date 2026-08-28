import type { SessionKind } from '@shared/types'

/**
 * Marks for the session-type strip.
 *
 * Monochrome and drawn, unlike the ribbon's colourful toolbar icons: these sit
 * twelve-in-a-row inside a form, so they have to read as one family and take
 * their colour from the tile (Text Dim at rest, the accent when selected).
 * They replace a set of Unicode glyphs — 🖵, ⚟, ✳ and friends — each of which
 * rendered differently per font and carried its own invented hex colour.
 *
 * One stroke weight (1.6), one grid (24), no fills. Legible at 18px.
 */
interface Props {
  size?: number
}

const box = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
})

/** A terminal window: the shared silhouette for everything shell-shaped. */
function Window({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M2.5 8h19" />
      {children}
    </>
  )
}

/** A display: the shared silhouette for everything desktop-shaped. */
function Display({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <rect x="2.5" y="4.5" width="19" height="13" rx="2" />
      <path d="M9 21h6M12 17.5V21" />
      {children}
    </>
  )
}

export function IconTypeSsh({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Window>
        <path d="M6 12l2.5 2L6 16" />
        <path d="M15.5 14.5v-1.2a1.7 1.7 0 0 1 3.4 0v1.2" />
        <rect x="14.6" y="14.5" width="5.2" height="3.4" rx="0.9" />
      </Window>
    </svg>
  )
}

export function IconTypeTelnet({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Window>
        <path d="M6 12l2.5 2L6 16" />
        {/* An open shackle: the protocol is unencrypted, and the mark says so. */}
        <path d="M15.5 14.5v-1.2a1.7 1.7 0 0 1 3.4-.3" />
        <rect x="14.6" y="14.5" width="5.2" height="3.4" rx="0.9" />
      </Window>
    </svg>
  )
}

export function IconTypeRsh({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Window>
        <path d="M6 12l2.5 2L6 16" />
        <path d="M11.5 12l2.5 2-2.5 2" />
        <path d="M16 12l2.5 2-2.5 2" />
      </Window>
    </svg>
  )
}

export function IconTypeXdmcp({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Display>
        <path d="M9 8.5l6 5M15 8.5l-6 5" />
      </Display>
    </svg>
  )
}

export function IconTypeRdp({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Display>
        <path d="M9.5 8l5.5 3.4-2.4.8-.9 2.3z" />
      </Display>
    </svg>
  )
}

export function IconTypeVnc({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Display>
        <path d="M8 11h8" />
        <path d="M10 9l-2 2 2 2M14 9l2 2-2 2" />
      </Display>
    </svg>
  )
}

export function IconTypeFtp({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <path d="M8 20V6M8 6L5 9M8 6l3 3" />
      <path d="M16 4v14M16 18l3-3M16 18l-3-3" />
    </svg>
  )
}

export function IconTypeSftp({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <path d="M2.5 19V7a1.5 1.5 0 0 1 1.5-1.5h5l2 2.5h6.5A1.5 1.5 0 0 1 19 9.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19z" />
      <path d="M11 17.5v-4M11 13.5l-1.8 1.8M11 13.5l1.8 1.8" />
    </svg>
  )
}

export function IconTypeSerial({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      {/* A D-sub shell, which is what a serial console still plugs into. */}
      <path d="M4 9.5h16l-1.6 6.2a1.5 1.5 0 0 1-1.45 1.1H7.05a1.5 1.5 0 0 1-1.45-1.1z" />
      <path d="M7.8 12.4h.01M11 12.4h.01M14.2 12.4h.01M9.4 14.6h.01M12.6 14.6h.01" strokeWidth="2" />
    </svg>
  )
}

export function IconTypeLocal({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Window>
        <path d="M6 12l2.5 2L6 16" />
        <path d="M11 16.5h6.5" />
      </Window>
    </svg>
  )
}

export function IconTypeBrowser({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.4 9.2h17.2M3.4 14.8h17.2" />
      <path d="M12 3c-2.4 2.4-3.6 5.4-3.6 9s1.2 6.6 3.6 9c2.4-2.4 3.6-5.4 3.6-9S14.4 5.4 12 3z" />
    </svg>
  )
}

export function IconTypeMosh({ size = 18 }: Props) {
  return (
    <svg {...box(size)}>
      <Window>
        <path d="M6 12l2.5 2L6 16" />
        {/* Roaming: the connection survives the network moving under it. */}
        <path d="M13 16.4a3.4 3.4 0 0 1 4.8 0" />
        <path d="M11.4 14.3a5.7 5.7 0 0 1 8 0" />
      </Window>
    </svg>
  )
}

const BY_KIND: Partial<Record<SessionKind, (p: Props) => JSX.Element>> = {
  ssh: IconTypeSsh,
  telnet: IconTypeTelnet,
  rsh: IconTypeRsh,
  xdmcp: IconTypeXdmcp,
  rdp: IconTypeRdp,
  vnc: IconTypeVnc,
  ftp: IconTypeFtp,
  sftp: IconTypeSftp,
  serial: IconTypeSerial,
  local: IconTypeLocal,
  browser: IconTypeBrowser,
  mosh: IconTypeMosh
}

/** The mark for a session kind, or the shell window as a neutral fallback. */
export function SessionTypeIcon({ kind, size = 18 }: { kind: SessionKind; size?: number }) {
  const Mark = BY_KIND[kind] ?? IconTypeLocal
  return <Mark size={size} />
}
