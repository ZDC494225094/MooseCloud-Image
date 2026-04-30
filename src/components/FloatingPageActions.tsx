import { createPortal } from 'react-dom'
import ThemeToggle, { FLOATING_ACTION_BUTTON_CLASS_NAME } from './ThemeToggle'

export default function FloatingPageActions() {
  return createPortal(
    <div className="fixed right-5 top-24 z-[90] flex flex-col items-center gap-3 sm:right-6 sm:top-28">
      <a
        href="https://moosecloud.cc"
        target="_blank"
        rel="noopener noreferrer"
        className={FLOATING_ACTION_BUTTON_CLASS_NAME}
        title="主站"
        aria-label="打开主站"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5L12 3l9 7.5" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.25 9.75V20a.75.75 0 00.75.75h3.75v-5.25c0-.414.336-.75.75-.75h3c.414 0 .75.336.75.75v5.25H18a.75.75 0 00.75-.75V9.75"
          />
        </svg>
        <span className="sr-only">主站</span>
      </a>
      <ThemeToggle portal={false} className={FLOATING_ACTION_BUTTON_CLASS_NAME} />
    </div>,
    document.body,
  )
}
