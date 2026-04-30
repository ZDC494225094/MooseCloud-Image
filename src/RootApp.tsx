import { useEffect, useMemo, useRef, useState } from 'react'
import App from './App'
import GalleryApp from './gallery/GalleryApp'
import { initStore, useStore } from './store'
import { normalizeBaseUrl } from './lib/api'
import type { ApiMode } from './types'

type AppView = 'gallery' | 'playground'
const RESUME_ACTIVE_TASKS_KEY = 'gpt-image-playground:resume-active-tasks'

function getAppViewFromPathname(pathname: string): AppView {
  return pathname.endsWith('/playground.html') ? 'playground' : 'gallery'
}

function isInternalAppUrl(url: URL): boolean {
  if (url.origin !== window.location.origin) return false
  return (
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/playground.html')
  )
}

function navigateTo(url: URL, onChange: (view: AppView) => void) {
  const nextHref = `${url.pathname}${url.search}${url.hash}`
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextHref === currentHref) return

  window.history.pushState(null, '', nextHref)
  window.scrollTo({ top: 0, behavior: 'auto' })
  onChange(getAppViewFromPathname(url.pathname))
}

function applyPlaygroundUrlState(
  pathname: string,
  search: string,
  setSettings: ReturnType<typeof useStore.getState>['setSettings'],
  setPrompt: ReturnType<typeof useStore.getState>['setPrompt'],
) {
  if (getAppViewFromPathname(pathname) !== 'playground') return

  const searchParams = new URLSearchParams(search)
  const nextSettings: { baseUrl?: string; apiKey?: string; codexCli?: boolean; apiMode?: ApiMode } = {}

  const apiUrlParam = searchParams.get('apiUrl')
  if (apiUrlParam !== null) {
    nextSettings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
  }

  const apiKeyParam = searchParams.get('apiKey')
  if (apiKeyParam !== null) {
    nextSettings.apiKey = apiKeyParam.trim()
  }

  const codexCliParam = searchParams.get('codexCli')
  if (codexCliParam !== null) {
    nextSettings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
  }

  const apiModeParam = searchParams.get('apiMode')
  if (apiModeParam === 'images' || apiModeParam === 'responses') {
    nextSettings.apiMode = apiModeParam
  }

  if (Object.keys(nextSettings).length > 0) {
    setSettings(nextSettings)
  }

  const promptParam = searchParams.get('prompt')
  if (promptParam !== null) {
    setPrompt(promptParam)
  }

  if (
    searchParams.has('apiUrl') ||
    searchParams.has('apiKey') ||
    searchParams.has('codexCli') ||
    searchParams.has('apiMode') ||
    searchParams.has('prompt')
  ) {
    searchParams.delete('apiUrl')
    searchParams.delete('apiKey')
    searchParams.delete('codexCli')
    searchParams.delete('apiMode')
    searchParams.delete('prompt')

    const nextSearch = searchParams.toString()
    const nextUrl = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', nextUrl)
  }
}

export default function RootApp() {
  const setSettings = useStore((state) => state.setSettings)
  const setPrompt = useStore((state) => state.setPrompt)
  const [view, setView] = useState<AppView>(() => getAppViewFromPathname(window.location.pathname))
  const didInitStoreRef = useRef(false)

  useEffect(() => {
    if (didInitStoreRef.current) return
    didInitStoreRef.current = true
    let resumeActiveTasks = false
    try {
      resumeActiveTasks = window.sessionStorage.getItem(RESUME_ACTIVE_TASKS_KEY) === '1'
      window.sessionStorage.removeItem(RESUME_ACTIVE_TASKS_KEY)
    } catch {
      resumeActiveTasks = false
    }
    void initStore({ resumeActiveTasks })
  }, [])

  useEffect(() => {
    applyPlaygroundUrlState(window.location.pathname, window.location.search, setSettings, setPrompt)
  }, [setPrompt, setSettings, view])

  useEffect(() => {
    const markForResume = () => {
      try {
        const hasRunningTasks = useStore.getState().tasks.some((task) => task.status === 'running')
        if (hasRunningTasks) {
          window.sessionStorage.setItem(RESUME_ACTIVE_TASKS_KEY, '1')
        } else {
          window.sessionStorage.removeItem(RESUME_ACTIVE_TASKS_KEY)
        }
      } catch {
        /* ignore */
      }
    }

    window.addEventListener('beforeunload', markForResume)
    window.addEventListener('pagehide', markForResume)
    return () => {
      window.removeEventListener('beforeunload', markForResume)
      window.removeEventListener('pagehide', markForResume)
    }
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setView(getAppViewFromPathname(window.location.pathname))
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const url = new URL(anchor.href, window.location.href)
      if (!isInternalAppUrl(url)) return

      event.preventDefault()
      navigateTo(url, setView)
    }

    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleDocumentClick)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [])

  const content = useMemo(() => (
    view === 'playground' ? <App /> : <GalleryApp />
  ), [view])

  return content
}
