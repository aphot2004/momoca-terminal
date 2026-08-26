import type { ITheme } from '@xterm/xterm'

export type ThemeName = 'dark' | 'light'

const dark: ITheme = {
  background: '#11131a',
  foreground: '#d5dae5',
  cursor: '#7aa2f7',
  cursorAccent: '#11131a',
  selectionBackground: '#2c3450',

  black: '#1a1d26',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',

  brightBlack: '#414868',
  brightRed: '#ff7a93',
  brightGreen: '#b9f27c',
  brightYellow: '#ff9e64',
  brightBlue: '#7da6ff',
  brightMagenta: '#bb9af7',
  brightCyan: '#0db9d7',
  brightWhite: '#e6eaf5'
}

const light: ITheme = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#0969da',
  cursorAccent: '#ffffff',
  selectionBackground: '#b6d7ff',

  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#8a6100',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',

  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#a55f00',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#1f2328'
}

export const terminalThemes: Record<ThemeName, ITheme> = { dark, light }

export const TERMINAL_FONT = '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace'

const STORAGE_KEY = 'mobaclone.theme'

export function loadTheme(): ThemeName {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function persistTheme(theme: ThemeName): void {
  localStorage.setItem(STORAGE_KEY, theme)
  document.documentElement.dataset.theme = theme
}
