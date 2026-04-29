export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'moosecloud-theme-mode'

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null
}

export function getPreferredTheme(): ThemeMode {
  return getStoredTheme() || getSystemTheme()
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return

  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.body.classList.toggle('dark', theme === 'dark')

  const metaTheme = document.querySelector('meta[name="theme-color"]')
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#111827' : '#f8fafc')
  }
}

export function setTheme(theme: ThemeMode) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }

  applyTheme(theme)
}

export function initializeTheme() {
  applyTheme(getPreferredTheme())
}
