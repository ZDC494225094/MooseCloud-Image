import { useEffect, useState } from 'react'
import { getPreferredTheme, setTheme, type ThemeMode } from '../lib/theme'

const BUTTON_CLASS_NAME =
  'rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeMode>('dark')

  useEffect(() => {
    setThemeState(getPreferredTheme())
  }, [])

  const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(nextTheme)
        setThemeState(nextTheme)
      }}
      className={BUTTON_CLASS_NAME}
      title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
      aria-label={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
    >
      {theme === 'dark' ? '白天' : '黑夜'}
    </button>
  )
}
