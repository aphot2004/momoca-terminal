/**
 * Inline SVG icons. Inline rather than a font or sprite sheet because the
 * renderer's CSP blocks external assets and these need to recolour per theme.
 */

interface IconProps {
  size?: number
}

const box = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg'
})

export function IconSession({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2" y="4" width="20" height="13" rx="2" fill="#4c7ce0" />
      <rect x="4" y="6" width="16" height="9" rx="1" fill="#1b2233" />
      <path d="M7 9.5 9.5 11 7 12.5" stroke="#8fe3a0" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11.5 12.8h4" stroke="#8fe3a0" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 21h8M12 17v4" stroke="#4c7ce0" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconLocal({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2" y="3" width="20" height="18" rx="2.5" fill="#2f3b52" />
      <rect x="2" y="3" width="20" height="4" rx="2.5" fill="#4a5878" />
      <path d="M6 12l3 2.5L6 17" stroke="#8fe3a0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 17.2H18" stroke="#8fe3a0" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconKey({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <circle cx="7.5" cy="8.5" r="4.5" stroke="#e6b455" strokeWidth="2.2" />
      <path
        d="M10.8 11.8 20 21"
        stroke="#e6b455"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M17 18l2.2-2.2M14.2 15.2l2-2" stroke="#e6b455" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconSessions({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="3" y="4" width="18" height="4" rx="1.2" fill="#c98fe0" />
      <rect x="3" y="10" width="18" height="4" rx="1.2" fill="#9a7ce0" />
      <rect x="3" y="16" width="18" height="4" rx="1.2" fill="#7a6ad0" />
    </svg>
  )
}

export function IconFiles({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="#e0b25c"
      />
      <path d="M3 10.5h18v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="#f0c877" />
    </svg>
  )
}

export function IconTheme({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="12" r="8.5" stroke="#7aa2f7" strokeWidth="2" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="#7aa2f7" />
    </svg>
  )
}

export function IconSplit({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" stroke="#6fd0c0" strokeWidth="2" />
      <path d="M12 4v16" stroke="#6fd0c0" strokeWidth="2" />
    </svg>
  )
}

export function IconExit({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M12 3v9"
        stroke="#e35f6f"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M6.8 6.8a7.5 7.5 0 1 0 10.4 0"
        stroke="#e35f6f"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function IconMultiExec({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2.5" y="3.5" width="8.5" height="7" rx="1.4" fill="#2f3b52" stroke="#e0af68" strokeWidth="1.4" />
      <rect x="13" y="3.5" width="8.5" height="7" rx="1.4" fill="#2f3b52" stroke="#e0af68" strokeWidth="1.4" />
      <rect x="2.5" y="13.5" width="8.5" height="7" rx="1.4" fill="#2f3b52" stroke="#e0af68" strokeWidth="1.4" />
      <rect x="13" y="13.5" width="8.5" height="7" rx="1.4" fill="#2f3b52" stroke="#e0af68" strokeWidth="1.4" />
      <path d="M12 11.4v1.2" stroke="#e0af68" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconView({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" stroke="#7aa2f7" strokeWidth="1.9" fill="none" />
      <circle cx="12" cy="12" r="2.8" fill="#7aa2f7" />
    </svg>
  )
}

export function IconToolbox({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2.5" y="8.5" width="19" height="11.5" rx="2" fill="#e0a83c" />
      <path d="M8.5 8.5V6.6a1.6 1.6 0 0 1 1.6-1.6h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9" stroke="#b8863a" strokeWidth="2" fill="none" />
      <rect x="2.5" y="12" width="19" height="2.6" fill="#b8863a" />
      <rect x="10.4" y="11" width="3.2" height="4.6" rx="0.8" fill="#5a3f16" />
    </svg>
  )
}

export function IconNetwork({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="5" r="2.6" fill="#5aa9e0" />
      <circle cx="5" cy="18.5" r="2.6" fill="#6fd0c0" />
      <circle cx="19" cy="18.5" r="2.6" fill="#6fd0c0" />
      <path d="M12 7.6v4.9M12 12.5 5.9 16.6M12 12.5l6.1 4.1" stroke="#4c7ce0" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconMacro({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="12" r="9" stroke="#bb9af7" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="4" fill="#e35f6f" />
    </svg>
  )
}

export function IconUnix({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2.5" y="4" width="19" height="16" rx="2.2" fill="#2f3b52" />
      <path d="M6 10l3 2.6L6 15.2" stroke="#9ece6a" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M11.5 15.4H18" stroke="#9ece6a" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export function IconVault({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="3.5" y="9" width="17" height="12" rx="2.2" fill="#e0b25c" />
      <path
        d="M7.5 9V6.8a4.5 4.5 0 0 1 9 0V9"
        stroke="#b8863a"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14.6" r="1.7" fill="#5a3f16" />
      <path d="M12 15.8v2.2" stroke="#5a3f16" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconHelp({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <circle cx="12" cy="12" r="9.2" stroke="#5aa9e0" strokeWidth="2" fill="none" />
      <path
        d="M9.4 9.3a2.7 2.7 0 1 1 3.5 2.6c-.6.2-.9.7-.9 1.3v.6"
        stroke="#5aa9e0"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="17" r="1.2" fill="#5aa9e0" />
    </svg>
  )
}

export function IconTunnel({ size = 22 }: IconProps) {
  return (
    <svg {...box(size)}>
      <ellipse cx="5" cy="12" rx="2.6" ry="6" stroke="#6fd0c0" strokeWidth="2" fill="none" />
      <ellipse cx="19" cy="12" rx="2.6" ry="6" stroke="#6fd0c0" strokeWidth="2" fill="none" />
      <path d="M5 6h14M5 18h14" stroke="#6fd0c0" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.5 12h7m0 0-2.4-2.2M15.5 12l-2.4 2.2" stroke="#e0b25c" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- SFTP toolbar ---------- */

/**
 * The product mark. The same drawing as `build/icon.svg`, minus the bezel
 * hairline and the calibration ticks: below about 128px those are sub-pixel and
 * only muddy the face. Colours are literal rather than tokenised — a brand mark
 * does not invert with the theme.
 */
export function IconMark({ size = 58 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="MoMoca">
      <defs>
        <linearGradient id="mark-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1f2b" />
          <stop offset="1" stopColor="#0e1017" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="184" fill="url(#mark-face)" />
      <rect
        x="109"
        y="109"
        width="806"
        height="806"
        rx="178"
        fill="none"
        stroke="#39415a"
        strokeWidth="18"
      />
      <g transform="translate(17 4)">
        <path d="M214 680h560" stroke="#262c3d" strokeWidth="9" strokeLinecap="round" />
        <path
          d="M300 360L470 504L300 649"
          fill="none"
          stroke="#8b93a8"
          strokeWidth="62"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="560" y="360" width="160" height="320" rx="10" fill="#7aa2f7" />
      </g>
    </svg>
  )
}

export function IconGoUp({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="#e0b25c"
      />
      <path
        d="M12 18v-6m0 0-3 3m3-3 3 3"
        stroke="#2f3b52"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconDownload({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M12 3v11m0 0-4.2-4.2M12 14l4.2-4.2"
        stroke="#4caf50"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 18.5h16" stroke="#4caf50" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconUpload({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M12 17V6m0 0L7.8 10.2M12 6l4.2 4.2"
        stroke="#4caf50"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 20.5h16" stroke="#4caf50" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M20 12a8 8 0 1 1-2.6-5.9"
        stroke="#4a9be0"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M20 3.5V9h-5.5" stroke="#4a9be0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function IconNewFile({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M6 3h8l4 4v14H6z" fill="#dfe4ee" />
      <path d="M14 3v4h4" fill="#b9c0d0" />
      <path d="M12 11v6m-3-3h6" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function IconNewFolder({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="#e0b25c"
      />
      <path d="M12 10.5v6m-3-3h6" stroke="#2f3b52" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function IconDelete({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="#e35f6f"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M4.5 12.5 10 18 19.5 6.5"
        stroke="#4caf50"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function IconFolderSmall({ size = 14 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * File-row marks. Monochrome and drawn, inheriting the row's colour: these
 * replace 📁 and 📄, which rendered as full-colour emoji that ignored the theme
 * and shifted with the platform's font.
 */
const row = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
})

export function IconFolderRow({ size = 14 }: IconProps) {
  return (
    <svg {...row(size)}>
      <path d="M1.6 12.4V3.9a1 1 0 0 1 1-1h3.2l1.4 1.7h6.2a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z" />
    </svg>
  )
}

export function IconFileRow({ size = 14 }: IconProps) {
  return (
    <svg {...row(size)}>
      <path d="M3.4 1.9h5.3l3.9 3.9v8.3a1 1 0 0 1-1 1h-8.2a1 1 0 0 1-1-1V2.9a1 1 0 0 1 1-1z" />
      <path d="M8.6 1.9v4h3.9" />
    </svg>
  )
}

export function IconSymlinkRow({ size = 14 }: IconProps) {
  return (
    <svg {...row(size)}>
      <path d="M3.4 1.9h5.3l3.9 3.9v8.3a1 1 0 0 1-1 1h-8.2a1 1 0 0 1-1-1V2.9a1 1 0 0 1 1-1z" />
      <path d="M8.6 1.9v4h3.9" />
      <path d="M5.6 11.6l4-4M7.4 7.6h2.2v2.2" />
    </svg>
  )
}

/** Upload, but of a whole folder: the arrow rises out of the folder's mouth. */
export function IconUploadFolder({ size = 16 }: IconProps) {
  return (
    <svg {...row(size)}>
      <path d="M1.6 12.9V4.4a1 1 0 0 1 1-1h3.2l1.4 1.7h6.2a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z" />
      <path d="M8 12.2V7.4M8 7.4 6.2 9.2M8 7.4l1.8 1.8" />
    </svg>
  )
}
