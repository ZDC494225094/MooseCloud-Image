import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { initializeTheme } from './lib/theme'
import RootApp from './RootApp'

installMobileViewportGuards()
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
