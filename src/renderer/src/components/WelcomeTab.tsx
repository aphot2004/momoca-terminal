import { IconMark } from './Icons'
import type { ThemeName } from '../theme'

interface Props {
  theme: ThemeName
  onTheme: (theme: ThemeName) => void
  onLocalTerminal: () => void
}

/** Miniature of the app chrome, used for the theme picker cards. */
function ThemePreview({ variant }: { variant: ThemeName }) {
  const dark = variant === 'dark'
  const chrome = dark ? '#171a23' : '#e8eaef'
  const body = dark ? '#11131a' : '#ffffff'
  const line = dark ? '#2c3450' : '#c9cedb'
  const text = dark ? '#5c6784' : '#a8b0c2'

  return (
    <svg viewBox="0 0 160 100" className="theme-preview" role="img" aria-label={`${variant} theme`}>
      <rect width="160" height="100" rx="4" fill={body} />
      <rect width="160" height="14" rx="4" fill={chrome} />
      <rect y="14" width="46" height="86" fill={chrome} />
      <rect x="1" y="18" width="42" height="5" rx="2" fill={line} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="4" y={28 + i * 8} width="34" height="4" rx="2" fill={text} opacity="0.6" />
      ))}
      <rect x="46" y="14" width="114" height="10" fill={chrome} />
      <rect x="49" y="16" width="26" height="6" rx="2" fill={body} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x="50"
          y={30 + i * 9}
          width={[52, 38, 64, 30, 46][i]}
          height="4"
          rx="2"
          fill={dark ? '#7aa2f7' : '#4c7ce0'}
          opacity={i === 0 ? 0.9 : 0.45}
        />
      ))}
    </svg>
  )
}

export function WelcomeTab({ theme, onTheme, onLocalTerminal }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-brand">
        <IconMark />
        {/* The wordmark's one liberty: the caret from the icon, trailing the
            name the way it trails a line of shell output. */}
        <h1 className="wordmark">
          MoMoca<span className="wordmark-caret" aria-hidden="true" />
        </h1>
      </div>  <button className="start-local" onClick={onLocalTerminal}>
        <span className="start-plus">+</span> Start local terminal
      </button>

      <div className="welcome-hint">
        or double-click a saved session, or press <kbd>⌘T</kbd>
      </div>

      <div className="theme-picker">
        <div className="theme-picker-title">Select your favorite theme</div>
        <div className="theme-cards">
          {(['light', 'dark'] as ThemeName[]).map((variant) => (
            <button
              key={variant}
              className={`theme-card${theme === variant ? ' selected' : ''}`}
              onClick={() => onTheme(variant)}
            >
              <ThemePreview variant={variant} />
              <span>{variant === 'light' ? 'Light' : 'Dark'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
