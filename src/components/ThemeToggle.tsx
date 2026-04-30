import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getPreferredTheme, setTheme, type ThemeMode } from '../lib/theme'

export const FLOATING_ACTION_BUTTON_CLASS_NAME =
  'flex h-12 w-12 items-center justify-center rounded-full border border-gray-200/80 bg-white/92 text-amber-500 shadow-[0_12px_35px_rgba(15,23,42,0.14)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white dark:border-white/[0.08] dark:bg-gray-900/92 dark:text-sky-300 dark:shadow-[0_12px_35px_rgba(2,6,23,0.45)] dark:hover:bg-gray-900'

interface ThemeToggleProps {
  className?: string
  portal?: boolean
}

export default function ThemeToggle({
  className = `${FLOATING_ACTION_BUTTON_CLASS_NAME} fixed bottom-5 right-5 z-[90] sm:bottom-6 sm:right-6`,
  portal = true,
}: ThemeToggleProps = {}) {
  const [theme, setThemeState] = useState<ThemeMode>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setThemeState(getPreferredTheme())
    setMounted(true)
  }, [])

  const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
  const switchLabel = theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'

  if (!mounted) return null

  const button = (
    <button
      type="button"
      onClick={() => {
        setTheme(nextTheme)
        setThemeState(nextTheme)
      }}
      className={className}
      title={switchLabel}
      aria-label={switchLabel}
    >
      {theme === 'dark' ? (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="12" cy="12" r="4" />
          <path
            strokeLinecap="round"
            d="M12 2.5v2.25M12 19.25v2.25M4.93 4.93l1.6 1.6M17.47 17.47l1.6 1.6M2.5 12h2.25M19.25 12h2.25M4.93 19.07l1.6-1.6M17.47 6.53l1.6-1.6"
          />
        </svg>
      ) : (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.742 13.045a8.088 8.088 0 01-9.787-9.787 1 1 0 00-1.278-1.201A10 10 0 1021.943 14.323a1 1 0 00-1.201-1.278z" />
        </svg>
      )}
      <span className="sr-only">{switchLabel}</span>
    </button>
  )

  if (!portal) return button

  return createPortal(button, document.body)
}
