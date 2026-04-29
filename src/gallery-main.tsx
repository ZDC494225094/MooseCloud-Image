import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import GalleryApp from './gallery/GalleryApp'
import { initializeTheme } from './lib/theme'

installMobileViewportGuards()
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>,
)
