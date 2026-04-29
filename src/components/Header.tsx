import { useState } from 'react'
import { useStore } from '../store'
import HelpModal from './HelpModal'
import ThemeToggle from './ThemeToggle'

const NAV_BUTTON_CLASS_NAME =
  'rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'

export default function Header() {
  const setShowSettings = useStore((state) => state.setShowSettings)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <header
      data-no-drag-select
      className="safe-area-top sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/80"
    >
      <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-start gap-1">
          <h1 className="text-lg font-bold tracking-tight">
            <a
              href="./playground.html"
              className="text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300"
            >
              MooseCloud-Image
            </a>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <a href="./" className={NAV_BUTTON_CLASS_NAME} title="画廊">
            画廊
          </a>
          <a
            href="https://moosecloud.cc"
            target="_blank"
            rel="noopener noreferrer"
            className={NAV_BUTTON_CLASS_NAME}
            title="主站"
          >
            主站
          </a>
          <ThemeToggle />
          <button
            onClick={() => setShowHelp(true)}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
            title="操作指南"
          >
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
            title="设置"
          >
            <svg
              className="h-5 w-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
