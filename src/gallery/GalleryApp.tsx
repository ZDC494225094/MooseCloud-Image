import { useEffect, useMemo, useRef, useState } from 'react'
import FloatingPageActions from '../components/FloatingPageActions'
import Select from '../components/Select'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { getStoredGalleryFavoriteIds, saveGalleryFavoriteIds } from './galleryFavorites'
import GalleryImageLightbox from './GalleryImageLightbox'

interface PromptVariant {
  type: string
  label: string
  text: string
}

interface GalleryCaseSummary {
  id: string
  title: string
  category: string
  sourceType: string
  sourceLabel: string
  sourceName: string
  model: string
  tags: string[]
  coverImage: string
  prompt: string
  promptLength: number
  promptCount: number
  hasPrompt: boolean
  imageCount: number
  caseNumber: number | null
  sortValue: number
  detailChunk: number
}

interface GalleryCaseDetail {
  id: string
  sourceItemUrl: string
  externalSourceUrl: string
  authorHandle: string
  authorUrl: string
  imagePaths?: string[]
  images: string[]
  prompt: string
  prompts: PromptVariant[]
  createdAt: string
  updatedAt: string
}

type GalleryCase = GalleryCaseSummary & GalleryCaseDetail

interface GallerySource {
  id: string
  label: string
  type: string
  url: string
}

interface GalleryPayload {
  syncedAt: string
  totalCases: number
  categories: string[]
  cases: GalleryCaseSummary[]
  sources?: GallerySource[]
  sourceRepo?: string
  sourceReadme?: string
}

type GalleryPromptSearchMap = Record<string, string>
type GalleryDetailChunkMap = Record<string, GalleryCaseDetail>

type SortMode = 'latest' | 'oldest' | 'title' | 'promptLength'

interface GalleryViewState {
  query: string
  category: string
  sourceFilter: string
  favoriteOnly: boolean
  sortMode: SortMode
  batchStart: number
  visibleCount: number
  scrollY: number
}

const INITIAL_VISIBLE_CASES = 24
const LOAD_MORE_BATCH_SIZE = 18
const GALLERY_DATA_CACHE_NAME = `gpt-image-playground:gallery-index:${__APP_VERSION__}`
const GALLERY_DATA_CACHE_REQUEST = './data/cases.index.json'
const GALLERY_PROMPT_SEARCH_CACHE_NAME = `gpt-image-playground:gallery-search:${__APP_VERSION__}`
const GALLERY_PROMPT_SEARCH_CACHE_REQUEST = './data/cases.search.json'
const GALLERY_DETAIL_CHUNK_CACHE_NAME = `gpt-image-playground:gallery-details:${__APP_VERSION__}`
const GALLERY_VIEW_STATE_KEY = 'gpt-image-playground:gallery-view-state'
const NAV_BUTTON_CLASS_NAME =
  'rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'
const ACTIVE_FAVORITE_BUTTON_CLASS_NAME =
  'border-yellow-400 bg-yellow-50 text-yellow-500 dark:bg-yellow-500/10 dark:text-yellow-400'
const INACTIVE_FAVORITE_BUTTON_CLASS_NAME =
  'border-gray-200 bg-white text-gray-400 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'

let galleryPayloadMemoryCache: GalleryPayload | null = null
let galleryPromptSearchMemoryCache: GalleryPromptSearchMap | null = null
const galleryDetailChunkMemoryCache = new Map<number, GalleryDetailChunkMap>()
const galleryDetailChunkPromiseCache = new Map<number, Promise<GalleryDetailChunkMap>>()

const CATEGORY_LABELS: Record<string, string> = {
  'Ad Creative Cases': '广告创意案例',
  'Character Design Cases': '角色设计案例',
  'E-commerce Cases': '电商案例',
  'Portrait & Photography Cases': '人像摄影案例',
  'Poster & Illustration Cases': '海报插画案例',
  'UI & Social Media Mockup Cases': 'UI 与社媒案例',
  ChatGPT: 'ChatGPT 案例',
  'Nano Banana 2': 'Nano Banana 2 案例',
  'Nano banana pro': 'Nano Banana Pro 案例',
  OpenNana: 'OpenNana 案例',
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function normalizeCategoryKey(category: string) {
  return category.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

function getCategoryLabel(category: string) {
  const normalizedCategory = normalizeCategoryKey(category)
  return CATEGORY_LABELS[normalizedCategory] || normalizedCategory || '未分类'
}

function buildPlaygroundHref(prompt: string, referenceImage?: string) {
  const url = new URL('./playground.html', window.location.href)
  if (prompt.trim()) url.searchParams.set('prompt', prompt)
  if (referenceImage?.trim()) url.searchParams.append('referenceImage', referenceImage)
  return url.toString()
}

function getGalleryColumnCount() {
  if (typeof window === 'undefined') return 1
  if (window.innerWidth >= 1280) return 3
  if (window.innerWidth >= 768) return 2
  return 1
}

function createDefaultGalleryViewState(): GalleryViewState {
  return {
    query: '',
    category: 'all',
    sourceFilter: 'all',
    favoriteOnly: false,
    sortMode: 'latest',
    batchStart: 0,
    visibleCount: INITIAL_VISIBLE_CASES,
    scrollY: 0,
  }
}

function readStoredGalleryViewState(): GalleryViewState {
  const fallback = createDefaultGalleryViewState()

  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.sessionStorage.getItem(GALLERY_VIEW_STATE_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<GalleryViewState>
    return {
      query: typeof parsed.query === 'string' ? parsed.query : fallback.query,
      category: typeof parsed.category === 'string' ? parsed.category : fallback.category,
      sourceFilter: typeof parsed.sourceFilter === 'string' ? parsed.sourceFilter : fallback.sourceFilter,
      favoriteOnly: parsed.favoriteOnly === true,
      sortMode:
        parsed.sortMode === 'latest' ||
        parsed.sortMode === 'oldest' ||
        parsed.sortMode === 'title' ||
        parsed.sortMode === 'promptLength'
          ? parsed.sortMode
          : fallback.sortMode,
      batchStart:
        typeof parsed.batchStart === 'number' && Number.isFinite(parsed.batchStart)
          ? Math.max(0, Math.trunc(parsed.batchStart))
          : fallback.batchStart,
      visibleCount:
        typeof parsed.visibleCount === 'number' && Number.isFinite(parsed.visibleCount)
          ? Math.max(INITIAL_VISIBLE_CASES, Math.trunc(parsed.visibleCount))
          : fallback.visibleCount,
      scrollY:
        typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY)
          ? Math.max(0, Math.trunc(parsed.scrollY))
          : fallback.scrollY,
    }
  } catch {
    return fallback
  }
}

function writeStoredGalleryViewState(state: GalleryViewState) {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(GALLERY_VIEW_STATE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function normalizePromptVariants(item: Record<string, unknown>, prompt: string) {
  const rawPrompts = Array.isArray(item.prompts) ? item.prompts : []
  const prompts = rawPrompts
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null

      const promptEntry = entry as Record<string, unknown>
      const text = typeof promptEntry.text === 'string' ? promptEntry.text.trim() : ''
      if (!text) return null

      return {
        type: typeof promptEntry.type === 'string' ? promptEntry.type : 'default',
        label: typeof promptEntry.label === 'string' && promptEntry.label.trim()
          ? promptEntry.label
          : 'Prompt',
        text,
      }
    })
    .filter((entry): entry is PromptVariant => Boolean(entry))

  if (prompts.length > 0) return prompts
  if (!prompt.trim()) return []

  return [
    {
      type: 'default',
      label: 'Prompt',
      text: prompt.trim(),
    },
  ]
}

function normalizeCase(item: Record<string, unknown>, index: number) {
  const images = Array.isArray(item.images)
    ? item.images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const imagePaths = Array.isArray(item.imagePaths)
    ? item.imagePaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
  const prompts = normalizePromptVariants(item, prompt)
  const primaryPrompt = prompt || prompts[0]?.text || ''
  const sourceType = typeof item.sourceType === 'string' ? item.sourceType : 'github'
  const sourceLabel =
    typeof item.sourceLabel === 'string' && item.sourceLabel.trim()
      ? item.sourceLabel
      : sourceType === 'opennana'
        ? 'OpenNana'
        : 'Awesome GPT Image 2 Prompts'
  const authorHandle = typeof item.authorHandle === 'string' ? item.authorHandle : ''
  const sourceName =
    typeof item.sourceName === 'string' && item.sourceName.trim()
      ? item.sourceName
      : authorHandle
        ? `@${authorHandle.replace(/^@/, '')}`
        : sourceLabel
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : ''
  const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : ''
  const parsedSortValue =
    typeof item.sortValue === 'number' && Number.isFinite(item.sortValue)
      ? item.sortValue
      : typeof item.caseNumber === 'number'
        ? item.caseNumber
        : Number.MAX_SAFE_INTEGER - index
  const coverImage =
    typeof item.coverImage === 'string' && item.coverImage.trim()
      ? item.coverImage
      : images[0] || ''

  return {
    id: typeof item.id === 'string' ? item.id : `case-${index + 1}`,
    title: typeof item.title === 'string' && item.title.trim() ? item.title : '未命名案例',
    category: typeof item.category === 'string' && item.category.trim()
      ? item.category
      : sourceLabel,
    sourceType,
    sourceLabel,
    sourceItemUrl:
      typeof item.sourceItemUrl === 'string' && item.sourceItemUrl.trim()
        ? item.sourceItemUrl
        : typeof item.tweetUrl === 'string'
          ? item.tweetUrl
          : typeof item.repoUrl === 'string'
            ? item.repoUrl
            : '',
    externalSourceUrl:
      typeof item.externalSourceUrl === 'string' && item.externalSourceUrl.trim()
        ? item.externalSourceUrl
        : typeof item.tweetUrl === 'string'
          ? item.tweetUrl
          : '',
    sourceName,
    authorHandle,
    authorUrl:
      typeof item.authorUrl === 'string' && item.authorUrl.trim()
        ? item.authorUrl
        : typeof item.externalSourceUrl === 'string'
          ? item.externalSourceUrl
          : '',
    model: typeof item.model === 'string' ? item.model : '',
    tags: Array.isArray(item.tags)
      ? item.tags.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
    imagePaths,
    coverImage,
    images,
    prompt: primaryPrompt,
    prompts,
    promptLength:
      typeof item.promptLength === 'number' && Number.isFinite(item.promptLength)
        ? item.promptLength
        : primaryPrompt.length,
    promptCount: prompts.length > 0 ? prompts.length : primaryPrompt ? 1 : 0,
    hasPrompt: Boolean(primaryPrompt),
    imageCount: Math.max(images.length, coverImage ? 1 : 0),
    caseNumber: typeof item.caseNumber === 'number' ? item.caseNumber : null,
    sortValue: parsedSortValue,
    detailChunk: 0,
    createdAt,
    updatedAt,
  } satisfies GalleryCase
}

function normalizeGalleryCaseSummary(item: Record<string, unknown>, index: number) {
  const normalizedCase = normalizeCase(item, index)

  return {
    id: normalizedCase.id,
    title: normalizedCase.title,
    category: normalizedCase.category,
    sourceType: normalizedCase.sourceType,
    sourceLabel: normalizedCase.sourceLabel,
    sourceName: normalizedCase.sourceName,
    model: normalizedCase.model,
    tags: normalizedCase.tags,
    coverImage: normalizedCase.coverImage,
    prompt: normalizedCase.prompt,
    promptLength: normalizedCase.promptLength,
    promptCount: normalizedCase.promptCount,
    hasPrompt: normalizedCase.hasPrompt,
    imageCount: normalizedCase.imageCount,
    caseNumber: normalizedCase.caseNumber,
    sortValue: normalizedCase.sortValue,
    detailChunk:
      typeof item.detailChunk === 'number' && Number.isFinite(item.detailChunk)
        ? Math.max(0, Math.trunc(item.detailChunk))
        : 0,
  } satisfies GalleryCaseSummary
}

function normalizeGalleryCaseDetail(
  item: Record<string, unknown>,
  fallbackSummary?: GalleryCaseSummary | null,
) {
  const normalizedCase = normalizeCase(item, 0)

  return {
    id: normalizedCase.id || fallbackSummary?.id || '',
    sourceItemUrl: normalizedCase.sourceItemUrl,
    externalSourceUrl: normalizedCase.externalSourceUrl,
    authorHandle: normalizedCase.authorHandle,
    authorUrl: normalizedCase.authorUrl,
    images: normalizedCase.images,
    prompt: normalizedCase.prompt || fallbackSummary?.prompt || '',
    prompts: normalizedCase.prompts,
    createdAt: normalizedCase.createdAt,
    updatedAt: normalizedCase.updatedAt,
  } satisfies GalleryCaseDetail
}

function normalizePayload(input: GalleryPayload) {
  const cases = Array.isArray(input.cases)
    ? input.cases.map((item, index) =>
        normalizeGalleryCaseSummary(item as unknown as Record<string, unknown>, index),
      )
    : []

  return {
    syncedAt: typeof input.syncedAt === 'string' ? input.syncedAt : '',
    totalCases: cases.length,
    categories: unique(cases.map((item) => item.category)).sort((left, right) =>
      left.localeCompare(right, 'zh-CN'),
    ),
    cases,
    sources: Array.isArray(input.sources) ? input.sources : [],
    sourceRepo: input.sourceRepo,
    sourceReadme: input.sourceReadme,
  } satisfies GalleryPayload
}

function normalizePromptSearchMap(input: unknown) {
  if (!input || typeof input !== 'object') return null

  const rawCases = (input as { cases?: unknown }).cases
  if (!rawCases || typeof rawCases !== 'object') return null

  const entries = Object.entries(rawCases as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([caseId, value]) => [caseId, (value as string).toLowerCase()] as const)

  return Object.fromEntries(entries) satisfies GalleryPromptSearchMap
}

function normalizeDetailChunkPayload(input: unknown, chunkIndex: number) {
  if (!input || typeof input !== 'object') return {} satisfies GalleryDetailChunkMap

  const rawCases = (input as { cases?: unknown }).cases
  if (!rawCases || typeof rawCases !== 'object') return {} satisfies GalleryDetailChunkMap

  return Object.fromEntries(
    Object.entries(rawCases as Record<string, unknown>).map(([caseId, value]) => [
      caseId,
      normalizeGalleryCaseDetail(
        value as Record<string, unknown>,
        {
          id: caseId,
          title: '',
          category: '',
          sourceType: 'github',
          sourceLabel: '',
          sourceName: '',
          model: '',
          tags: [],
          coverImage: '',
          prompt: '',
          promptLength: 0,
          promptCount: 0,
          hasPrompt: false,
          imageCount: 0,
          caseNumber: null,
          sortValue: 0,
          detailChunk: chunkIndex,
        },
      ),
    ]),
  ) satisfies GalleryDetailChunkMap
}

async function readCachedGalleryPayload() {
  if (galleryPayloadMemoryCache) return galleryPayloadMemoryCache
  if (typeof window === 'undefined' || !('caches' in window)) return null

  try {
    const cache = await window.caches.open(GALLERY_DATA_CACHE_NAME)
    const response = await cache.match(GALLERY_DATA_CACHE_REQUEST)
    if (!response?.ok) return null

    const payload = normalizePayload((await response.json()) as GalleryPayload)
    galleryPayloadMemoryCache = payload
    return payload
  } catch {
    return null
  }
}

async function fetchLatestGalleryPayload() {
  const response = await fetch(GALLERY_DATA_CACHE_REQUEST, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const cacheableResponse = response.clone()
  const payload = normalizePayload((await response.json()) as GalleryPayload)
  galleryPayloadMemoryCache = payload

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(GALLERY_DATA_CACHE_NAME)
      await cache.put(GALLERY_DATA_CACHE_REQUEST, cacheableResponse)
    } catch {
      /* ignore */
    }
  }

  return payload
}

function getGalleryDetailChunkRequest(chunkIndex: number) {
  return `./data/case-details/chunk-${String(chunkIndex).padStart(3, '0')}.json`
}

async function readCachedGalleryPromptSearchMap() {
  if (galleryPromptSearchMemoryCache) return galleryPromptSearchMemoryCache
  if (typeof window === 'undefined' || !('caches' in window)) return null

  try {
    const cache = await window.caches.open(GALLERY_PROMPT_SEARCH_CACHE_NAME)
    const response = await cache.match(GALLERY_PROMPT_SEARCH_CACHE_REQUEST)
    if (!response?.ok) return null

    const promptSearchMap = normalizePromptSearchMap(await response.json())
    if (!promptSearchMap) return null

    galleryPromptSearchMemoryCache = promptSearchMap
    return promptSearchMap
  } catch {
    return null
  }
}

async function fetchLatestGalleryPromptSearchMap() {
  const response = await fetch(GALLERY_PROMPT_SEARCH_CACHE_REQUEST, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const cacheableResponse = response.clone()
  const promptSearchMap = normalizePromptSearchMap(await response.json())
  if (!promptSearchMap) throw new Error('Invalid prompt search payload')

  galleryPromptSearchMemoryCache = promptSearchMap

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(GALLERY_PROMPT_SEARCH_CACHE_NAME)
      await cache.put(GALLERY_PROMPT_SEARCH_CACHE_REQUEST, cacheableResponse)
    } catch {
      /* ignore */
    }
  }

  return promptSearchMap
}

async function fetchGalleryDetailChunk(chunkIndex: number) {
  const cachedChunk = galleryDetailChunkMemoryCache.get(chunkIndex)
  if (cachedChunk) return cachedChunk

  const existingPromise = galleryDetailChunkPromiseCache.get(chunkIndex)
  if (existingPromise) return existingPromise

  const request = getGalleryDetailChunkRequest(chunkIndex)
  const chunkPromise = (async () => {
    let cachedResponse: Response | null = null

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await window.caches.open(GALLERY_DETAIL_CHUNK_CACHE_NAME)
        cachedResponse = (await cache.match(request)) ?? null
      } catch {
        cachedResponse = null
      }
    }

    if (cachedResponse?.ok) {
      const cachedChunkMap = normalizeDetailChunkPayload(await cachedResponse.json(), chunkIndex)
      galleryDetailChunkMemoryCache.set(chunkIndex, cachedChunkMap)
      return cachedChunkMap
    }

    const response = await fetch(request, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const cacheableResponse = response.clone()
    const chunkMap = normalizeDetailChunkPayload(await response.json(), chunkIndex)
    galleryDetailChunkMemoryCache.set(chunkIndex, chunkMap)

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await window.caches.open(GALLERY_DETAIL_CHUNK_CACHE_NAME)
        await cache.put(request, cacheableResponse)
      } catch {
        /* ignore */
      }
    }

    return chunkMap
  })()

  galleryDetailChunkPromiseCache.set(chunkIndex, chunkPromise)

  try {
    return await chunkPromise
  } finally {
    galleryDetailChunkPromiseCache.delete(chunkIndex)
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function DetailMeta({
  label,
  value,
}: {
  label: string
  value: string
}) {
  if (!value.trim()) return null

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-gray-50/80 dark:bg-gray-900 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">{label}</p>
      <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-300">{value}</p>
    </div>
  )
}

function GalleryCaseModal({
  summary,
  detail,
  loadingDetail,
  detailError,
  onClose,
  isFavorite,
  onToggleFavorite,
}: {
  summary: GalleryCaseSummary | null
  detail: GalleryCaseDetail | null
  loadingDetail: boolean
  detailError: string
  onClose: () => void
  isFavorite: boolean
  onToggleFavorite: (caseId: string) => void
}) {
  const [imageIndex, setImageIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [copiedPromptIndex, setCopiedPromptIndex] = useState<number | null>(null)
  const [promptExpanded, setPromptExpanded] = useState(false)
  useCloseOnEscape(Boolean(summary), onClose)

  useEffect(() => {
    setImageIndex(0)
    setLightboxIndex(null)
    setCopiedPromptIndex(null)
    setPromptExpanded(false)
  }, [summary])

  useEffect(() => {
    if (copiedPromptIndex === null) return undefined

    const timer = window.setTimeout(() => setCopiedPromptIndex(null), 1800)
    return () => window.clearTimeout(timer)
  }, [copiedPromptIndex])

  if (!summary) return null

  const images = detail?.images.length ? detail.images : [summary.coverImage].filter(Boolean)
  const prompts = detail?.prompts.length
    ? detail.prompts
    : summary.prompt
      ? [
          {
            type: 'default',
            label: 'Prompt',
            text: summary.prompt,
          },
        ]
      : []
  const promptCount = detail?.prompts.length ?? summary.promptCount
  const primaryPrompt = detail?.prompt || summary.prompt
  const currentImage = images[imageIndex] || summary.coverImage
  const canNavigate = images.length > 1
  const item = {
    ...summary,
    sourceItemUrl: detail?.sourceItemUrl || '',
    externalSourceUrl: detail?.externalSourceUrl || '',
    authorHandle: detail?.authorHandle || '',
    authorUrl: detail?.authorUrl || '',
    images,
    prompt: primaryPrompt,
    prompts,
    createdAt: detail?.createdAt || '',
    updatedAt: detail?.updatedAt || '',
  } satisfies GalleryCase
  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-overlay-in"
        onClick={onClose}
      >
        <div
          className="w-full max-w-7xl max-h-[94vh] overflow-y-auto rounded-3xl border border-gray-200 dark:border-white/[0.08] bg-white/95 dark:bg-gray-950/95 shadow-2xl animate-modal-in"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-3xl border-b border-gray-200 dark:border-white/[0.08] bg-white/92 dark:bg-gray-950/92 px-4 py-3 backdrop-blur sm:items-start sm:gap-4 sm:px-5 sm:py-4">
            <div className="min-w-0 flex-1">
              <h2
                className="truncate text-base font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-2xl"
                title={summary.title}
              >
                {summary.title}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start">
              <button
                onClick={() => onToggleFavorite(summary.id)}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors sm:h-auto sm:w-auto sm:px-3 sm:py-2 sm:text-sm ${
                  isFavorite
                    ? ACTIVE_FAVORITE_BUTTON_CLASS_NAME
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
                title={isFavorite ? '取消收藏' : '收藏案例'}
                aria-label={isFavorite ? '取消收藏' : '收藏案例'}
              >
                <span className="inline-flex items-center gap-0 sm:gap-2">
                  <svg className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  <span className="hidden sm:inline">{isFavorite ? '已收藏' : '收藏'}</span>
                </span>
              </button>
              <a
                href={buildPlaygroundHref(primaryPrompt, currentImage)}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 sm:py-2"
              >
                <span className="sm:hidden">创作</span>
                <span className="hidden sm:inline">带去创作</span>
              </a>
              <button
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06] sm:h-auto sm:w-auto sm:px-3 sm:py-2"
                aria-label="关闭详情"
              >
                <svg className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="hidden sm:inline">关闭</span>
              </button>
            </div>
          </div>

          <div className="grid gap-5 p-5 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="space-y-4">
              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-gray-50 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
                <div className="relative flex min-h-[280px] items-center justify-center bg-gray-100 p-3 dark:bg-black/25 sm:min-h-[420px] xl:min-h-[520px]">
                  {canNavigate && (
                    <button
                      onClick={() => setImageIndex((value) => (value - 1 + images.length) % images.length)}
                      className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white transition-colors hover:bg-black/60 sm:flex"
                    >
                      ‹
                    </button>
                  )}

                  <button
                    onClick={() => setLightboxIndex(imageIndex)}
                    className="flex h-full w-full items-center justify-center"
                    title="打开大图"
                  >
                    {currentImage ? (
                      <img
                        src={currentImage}
                        alt={`${summary.title} ${imageIndex + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full min-h-[280px] w-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                        暂无图片
                      </div>
                    )}
                  </button>

                  {canNavigate && (
                    <button
                      onClick={() => setImageIndex((value) => (value + 1) % images.length)}
                      className="absolute right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white transition-colors hover:bg-black/60 sm:flex"
                    >
                      ›
                    </button>
                  )}
                </div>

                {canNavigate && (
                  <div className="flex gap-2 overflow-x-auto px-3 pb-3 hide-scrollbar">
                    {images.map((image, index) => (
                      <button
                        key={`${summary.id}-${index}`}
                        onClick={() => setImageIndex(index)}
                        className={`overflow-hidden rounded-2xl border ${
                          index === imageIndex
                            ? 'border-blue-400 ring-2 ring-blue-400/35'
                            : 'border-gray-200 dark:border-white/[0.08]'
                        }`}
                      >
                        <img src={image} alt={`${item.title} 缩略图 ${index + 1}`} className="h-20 w-auto max-w-none" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
                <div className="flex flex-wrap items-center gap-2">
                  {summary.tags.length > 0 ? (
                    summary.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500">暂无标签</span>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">提示词</h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      画廊列表只展示图片，提示词收在详情中。
                    </p>
                  </div>
                  <a
                    href={buildPlaygroundHref(primaryPrompt, currentImage)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-xs transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.06]"
                  >
                    使用主提示词
                  </a>
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => setPromptExpanded((value) => !value)}
                    className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:bg-black/20 dark:hover:bg-white/[0.04]"
                    aria-expanded={promptExpanded}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {promptCount > 0 ? `共 ${promptCount} 段提示词` : '暂无提示词'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {promptExpanded ? '收起提示词内容' : '展开查看完整提示词'}
                      </p>
                    </div>
                    <span className="text-xl leading-none text-gray-400 dark:text-gray-500">
                      {promptExpanded ? '−' : '+'}
                    </span>
                  </button>

                  {promptExpanded && (
                    <div className="mt-4 space-y-4">
                      {loadingDetail && prompts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                          正在加载完整提示词...
                        </div>
                      ) : detailError && prompts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-red-200 px-4 py-8 text-center text-sm text-red-500 dark:border-red-500/20">
                          完整提示词加载失败: {detailError}
                        </div>
                      ) : prompts.length > 0 ? (
                        prompts.map((promptItem, index) => (
                          <div
                            key={`${summary.id}-prompt-${index}`}
                            className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/85 dark:border-white/[0.08] dark:bg-black/20"
                          >
                            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
                              <div>
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                  {promptItem.label || `Prompt ${index + 1}`}
                                </p>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  {promptItem.text.length} 字符
                                </p>
                              </div>
                              <button
                                onClick={async () => {
                                  const copied = await copyToClipboard(promptItem.text)
                                  if (copied) setCopiedPromptIndex(index)
                                }}
                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.06]"
                              >
                                {copiedPromptIndex === index ? '已复制' : '复制'}
                              </button>
                            </div>
                            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm leading-7 text-gray-700 dark:text-gray-300">
                              {promptItem.text}
                            </pre>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                          这个案例暂未提供提示词正文。
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <DetailMeta label="作者 / 来源账号" value={item.sourceName} />
              <DetailMeta label="分类" value={getCategoryLabel(item.category)} />
            </section>
          </div>
        </div>
      </div>

      {lightboxIndex !== null && (
        <GalleryImageLightbox
          images={item.images.length > 0 ? item.images : [item.coverImage].filter(Boolean)}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}

export default function GalleryApp() {
  const initialViewStateRef = useRef<GalleryViewState>(readStoredGalleryViewState())
  const [payload, setPayload] = useState<GalleryPayload | null>(() => galleryPayloadMemoryCache)
  const [loading, setLoading] = useState(() => galleryPayloadMemoryCache == null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(() => initialViewStateRef.current.query)
  const [category, setCategory] = useState(() => initialViewStateRef.current.category)
  const [sourceFilter, setSourceFilter] = useState(() => initialViewStateRef.current.sourceFilter)
  const [favoriteOnly, setFavoriteOnly] = useState(() => initialViewStateRef.current.favoriteOnly)
  const [sortMode, setSortMode] = useState<SortMode>(() => initialViewStateRef.current.sortMode)
  const [activeCase, setActiveCase] = useState<GalleryCaseSummary | null>(null)
  const [activeCaseDetail, setActiveCaseDetail] = useState<GalleryCaseDetail | null>(null)
  const [activeCaseDetailLoading, setActiveCaseDetailLoading] = useState(false)
  const [activeCaseDetailError, setActiveCaseDetailError] = useState('')
  const [promptSearchMap, setPromptSearchMap] = useState<GalleryPromptSearchMap | null>(
    () => galleryPromptSearchMemoryCache,
  )
  const [promptSearchLoading, setPromptSearchLoading] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getStoredGalleryFavoriteIds())
  const [batchStart, setBatchStart] = useState(() => initialViewStateRef.current.batchStart)
  const [visibleCount, setVisibleCount] = useState(() => initialViewStateRef.current.visibleCount)
  const [columnCount, setColumnCount] = useState(() => getGalleryColumnCount())
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null)
  const autoLoadReadyRef = useRef(true)
  const didMountFilterResetRef = useRef(false)
  const restoredScrollRef = useRef(false)
  const latestScrollYRef = useRef(initialViewStateRef.current.scrollY)

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  useEffect(() => {
    saveGalleryFavoriteIds(favoriteIds)
  }, [favoriteIds])

  useEffect(() => {
    const handleResize = () => {
      setColumnCount(getGalleryColumnCount())
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    let alive = true

    const load = async () => {
      const cachedPayload = await readCachedGalleryPayload()
      if (alive && cachedPayload) {
        setPayload(cachedPayload)
        setError('')
        setLoading(false)
      }

      try {
        if (!cachedPayload) {
          setLoading(true)
        }

        const nextPayload = await fetchLatestGalleryPayload()
        if (!alive) return

        setPayload(nextPayload)
        setError('')
      } catch (err) {
        if (!alive) return
        if (!cachedPayload) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery || promptSearchMap || promptSearchLoading) return

    let alive = true

    const loadPromptSearch = async () => {
      setPromptSearchLoading(true)

      try {
        const cachedPromptSearch = await readCachedGalleryPromptSearchMap()
        if (alive && cachedPromptSearch) {
          setPromptSearchMap(cachedPromptSearch)
        }

        const latestPromptSearch = await fetchLatestGalleryPromptSearchMap()
        if (!alive) return

        setPromptSearchMap(latestPromptSearch)
      } catch {
        /* ignore prompt-search failures and keep metadata search available */
      } finally {
        if (alive) setPromptSearchLoading(false)
      }
    }

    void loadPromptSearch()

    return () => {
      alive = false
    }
  }, [promptSearchLoading, promptSearchMap, query])

  useEffect(() => {
    if (!activeCase) {
      setActiveCaseDetail(null)
      setActiveCaseDetailLoading(false)
      setActiveCaseDetailError('')
      return
    }

    let alive = true

    const loadCaseDetail = async () => {
      setActiveCaseDetail(null)
      setActiveCaseDetailLoading(true)
      setActiveCaseDetailError('')

      try {
        const chunkMap = await fetchGalleryDetailChunk(activeCase.detailChunk)
        if (!alive) return

        setActiveCaseDetail(chunkMap[activeCase.id] || null)
      } catch (err) {
        if (!alive) return

        setActiveCaseDetail(null)
        setActiveCaseDetailError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setActiveCaseDetailLoading(false)
      }
    }

    void loadCaseDetail()

    return () => {
      alive = false
    }
  }, [activeCase])

  useEffect(() => {
    const handleScroll = () => {
      latestScrollYRef.current = window.scrollY
    }

    const persistState = () => {
      writeStoredGalleryViewState({
        query,
        category,
        sourceFilter,
        favoriteOnly,
        sortMode,
        batchStart,
        visibleCount,
        scrollY: latestScrollYRef.current,
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('beforeunload', persistState)
    window.addEventListener('pagehide', persistState)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('beforeunload', persistState)
      window.removeEventListener('pagehide', persistState)
    }
  }, [batchStart, category, favoriteOnly, query, sortMode, sourceFilter, visibleCount])

  useEffect(() => {
    writeStoredGalleryViewState({
      query,
      category,
      sourceFilter,
      favoriteOnly,
      sortMode,
      batchStart,
      visibleCount,
      scrollY: latestScrollYRef.current,
    })
  }, [batchStart, category, favoriteOnly, query, sortMode, sourceFilter, visibleCount])

  const categories = useMemo(() => {
    const sourceCategories = payload?.categories || []
    return [
      { label: '全部分类', value: 'all' },
      ...sourceCategories.map((item) => ({ label: getCategoryLabel(item), value: item })),
    ]
  }, [payload])

  const sourceOptions = useMemo(() => {
    if (!payload) return [{ label: '全部来源', value: 'all' }]

    const knownSources = new Map<string, string>()
    payload.sources?.forEach((source) => {
      if (source.type) knownSources.set(source.type, source.label || source.type)
    })
    payload.cases.forEach((item) => {
      if (item.sourceType) knownSources.set(item.sourceType, item.sourceLabel || item.sourceType)
    })

    return [
      { label: '全部来源', value: 'all' },
      ...Array.from(knownSources.entries()).map(([value, label]) => ({ label, value })),
    ]
  }, [payload])

  const toggleFavorite = (caseId: string) => {
    setFavoriteIds((current) =>
      current.includes(caseId)
        ? current.filter((value) => value !== caseId)
        : [...current, caseId],
    )
  }

  const filteredCases = useMemo(() => {
    if (!payload) return []

    const normalizedQuery = query.trim().toLowerCase()
    const list = payload.cases.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false
      if (favoriteOnly && !favoriteIdSet.has(item.id)) return false
      if (!normalizedQuery) return true

      const haystack = [
        item.title,
        item.category,
        getCategoryLabel(item.category),
        item.sourceLabel,
        item.sourceName,
        item.model,
        item.prompt,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase()

      if (haystack.includes(normalizedQuery)) return true

      const promptSearchText = promptSearchMap?.[item.id]
      return typeof promptSearchText === 'string' ? promptSearchText.includes(normalizedQuery) : false
    })

    switch (sortMode) {
      case 'oldest':
        return [...list].sort((left, right) => left.sortValue - right.sortValue)
      case 'title':
        return [...list].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
      case 'promptLength':
        return [...list].sort((left, right) => right.promptLength - left.promptLength)
      case 'latest':
      default:
        return [...list].sort((left, right) => right.sortValue - left.sortValue)
    }
  }, [payload, query, category, sourceFilter, favoriteOnly, favoriteIdSet, promptSearchMap, sortMode])

  useEffect(() => {
    if (!didMountFilterResetRef.current) {
      didMountFilterResetRef.current = true
      return
    }

    setBatchStart(0)
    setVisibleCount(INITIAL_VISIBLE_CASES)
    autoLoadReadyRef.current = true
  }, [query, category, sourceFilter, favoriteOnly, sortMode])

  const visibleCases = useMemo(
    () => filteredCases.slice(batchStart, batchStart + visibleCount),
    [filteredCases, batchStart, visibleCount],
  )

  const hasMoreCases = batchStart + visibleCount < filteredCases.length
  const hasMultipleBatches = filteredCases.length > INITIAL_VISIBLE_CASES

  useEffect(() => {
    if (restoredScrollRef.current || loading || Boolean(error)) return

    restoredScrollRef.current = true
    const nextScrollY = initialViewStateRef.current.scrollY
    if (nextScrollY <= 0) return

    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => {
        window.scrollTo({ top: nextScrollY, behavior: 'auto' })
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [error, loading, visibleCases.length])

  const handleRefreshBatch = () => {
    if (!hasMultipleBatches) return

    setBatchStart((current) => {
      const nextStart = current + INITIAL_VISIBLE_CASES
      return nextStart >= filteredCases.length ? 0 : nextStart
    })
    setVisibleCount(INITIAL_VISIBLE_CASES)
    autoLoadReadyRef.current = true
  }

  useEffect(() => {
    if (!hasMoreCases) return undefined

    const target = loadMoreTriggerRef.current
    if (!target) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting)

        if (!isIntersecting) {
          autoLoadReadyRef.current = true
          return
        }

        if (autoLoadReadyRef.current) {
          autoLoadReadyRef.current = false
          setVisibleCount((value) => Math.min(value + LOAD_MORE_BATCH_SIZE, filteredCases.length))
        }
      },
      {
        rootMargin: '0px 0px 240px 0px',
        threshold: 0.1,
      },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [filteredCases.length, hasMoreCases, visibleCases.length])

  const visibleCaseColumns = useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as GalleryCaseSummary[])

    visibleCases.forEach((item, index) => {
      columns[index % columnCount].push(item)
    })

    return columns
  }, [columnCount, visibleCases])

  const renderCaseCard = (item: GalleryCaseSummary) => {
    const previewImage = item.coverImage
    const isFavorite = favoriteIdSet.has(item.id)

    return (
      <article key={item.id} className="relative">
        <button
          onClick={() => {
            setActiveCaseDetail(null)
            setActiveCaseDetailError('')
            setActiveCase(item)
          }}
          className="group block w-full overflow-hidden rounded-3xl border border-gray-200 bg-white text-left shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:border-white/[0.18]"
          title={item.title}
          aria-label={`鏌ョ湅 ${item.title} 璇︽儏`}
        >
          <div className="relative overflow-hidden">
            {previewImage ? (
              <img
                src={previewImage}
                alt={item.title}
                loading="lazy"
                className="block w-full h-auto transition-transform duration-300 group-hover:scale-[1.015]"
              />
            ) : (
              <div className="flex min-h-[240px] items-center justify-center bg-gray-100 px-6 py-10 text-sm text-gray-400 dark:bg-gray-950 dark:text-gray-500">
                {item.title}
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-4 pt-12">
              <div className="flex flex-wrap gap-2">
                {(item.tags.length > 0 ? item.tags.slice(0, 3) : [getCategoryLabel(item.category)]).map((tag) => (
                  <span
                    key={`${item.id}-${tag}`}
                    className="inline-flex items-center rounded-full border border-white/15 bg-white/12 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h3 className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-white drop-shadow-[0_1px_10px_rgba(0,0,0,0.35)] sm:text-lg">
                {item.title}
              </h3>
            </div>
          </div>
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation()
            toggleFavorite(item.id)
          }}
          className={`absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur transition ${
            isFavorite
              ? 'border-yellow-400/70 bg-yellow-400 text-white shadow-[0_10px_24px_rgba(250,204,21,0.35)]'
              : 'border-white/20 bg-black/35 text-white hover:bg-black/50'
          }`}
          title={isFavorite ? '鍙栨秷鏀惰棌' : '鏀惰棌妗堜緥'}
          aria-label={isFavorite ? '鍙栨秷鏀惰棌' : '鏀惰棌妗堜緥'}
        >
          <svg className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </article>
    )
  }

  const statItems = useMemo(() => {
    if (!payload) return []

    const imageCount = payload.cases.reduce((sum, item) => sum + Math.max(item.imageCount, 1), 0)
    const sourceCount = unique(payload.cases.map((item) => item.sourceLabel)).length

    return [
      { label: '案例总数', value: payload.totalCases },
      { label: '图片数量', value: imageCount },
      { label: '来源数量', value: sourceCount },
      {
        label: '含提示词案例',
        value: payload.cases.filter((item) => item.hasPrompt).length,
      },
    ]
  }, [payload])

  return (
    <>
      <header className="safe-area-top sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/80">
        <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">
              MooseCloud-创意画廊
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">多来源 AI 图片提示词画廊</p>
          </div>
          <nav className="flex shrink-0 items-center gap-2">
            <a
              href="./playground.html"
              className={NAV_BUTTON_CLASS_NAME}
            >
              创作台
            </a>
          </nav>
        </div>
      </header>
      <FloatingPageActions />

      <main className="pb-16">
        <div className="safe-area-x mx-auto max-w-7xl">
          <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-gray-900 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.18em] text-blue-500">Image-First Gallery</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl">
                  创意画廊
                </h2>
             
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href="./playground.html"
                  className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                >
                  打开创作台
                </a>
              </div>
            </div>

            {payload && (
              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {statItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-gray-200 bg-gray-50/90 p-4 dark:border-white/[0.08] dark:bg-gray-950"
                  >
                    <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl">
                      {item.value}
                    </p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-6">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative z-10 flex-1">
                <svg
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="text"
                  placeholder="搜索标题、模型、标签或提示词..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900"
                />
              </div>

              <div className="z-20 w-full md:w-56">
                <Select
                  value={category}
                  onChange={(value) => setCategory(String(value))}
                  options={categories}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm transition hover:bg-gray-50 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]"
                />
              </div>

              <div className="z-20 w-full md:w-52">
                <Select
                  value={sourceFilter}
                  onChange={(value) => setSourceFilter(String(value))}
                  options={sourceOptions}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm transition hover:bg-gray-50 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]"
                />
              </div>

              <button
                onClick={() => setFavoriteOnly((value) => !value)}
                className={`z-20 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition md:w-auto ${
                  favoriteOnly ? ACTIVE_FAVORITE_BUTTON_CLASS_NAME : INACTIVE_FAVORITE_BUTTON_CLASS_NAME
                }`}
                title={favoriteOnly ? '取消只看收藏' : '只看收藏'}
              >
                <svg className="h-4 w-4" fill={favoriteOnly ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                只看收藏
              </button>

              <button
                onClick={handleRefreshBatch}
                disabled={!hasMultipleBatches}
                className="z-20 order-last inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06] md:w-auto"
                title="换一批"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                换一批
              </button>

              <div className="z-20 w-full md:w-44">
                <Select
                  value={sortMode}
                  onChange={(value) => setSortMode(value as SortMode)}
                  options={[
                    { label: '最新优先', value: 'latest' },
                    { label: '最早优先', value: 'oldest' },
                    { label: '标题 A-Z', value: 'title' },
                    { label: '提示词最长', value: 'promptLength' },
                  ]}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm transition hover:bg-gray-50 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]"
                />
              </div>
            </div>

            {payload && (
              <div className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-500 dark:text-gray-400">
                <p>
                  当前显示 {filteredCases.length} / {payload.totalCases} 个案例
                </p>
                <p>{payload.syncedAt ? `同步时间：${formatDate(payload.syncedAt)}` : ''}</p>
              </div>
            )}
          </section>

          <section className="mt-6">
            {loading && (
              <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-gray-500 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400">
                正在加载画廊数据...
              </div>
            )}

            {!loading && error && (
              <div className="rounded-3xl border border-red-200 bg-white p-10 text-center text-red-500 dark:border-red-500/20 dark:bg-gray-900">
                数据加载失败：{error}
              </div>
            )}

            {!loading && !error && filteredCases.length === 0 && (
              <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-gray-500 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400">
                没有找到匹配的案例。
              </div>
            )}

            {!loading && !error && filteredCases.length > 0 && (
              <>
                <div
                  className="grid items-start gap-4"
                  style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
                >
                  {visibleCaseColumns.map((column, columnIndex) => (
                    <div key={`gallery-column-${columnIndex}`} className="space-y-4">
                      {column.map(renderCaseCard)}
                    </div>
                  ))}
                </div>

                {hasMoreCases && (
                  <div ref={loadMoreTriggerRef} className="mt-8 flex flex-col items-center gap-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      已显示 {visibleCases.length} / {filteredCases.length} 个案例
                    </p>
                    <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-3 text-sm text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                      滚动到底部后将自动加载更多
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <GalleryCaseModal
        summary={activeCase}
        detail={activeCaseDetail}
        loadingDetail={activeCaseDetailLoading}
        detailError={activeCaseDetailError}
        onClose={() => {
          setActiveCase(null)
          setActiveCaseDetail(null)
          setActiveCaseDetailLoading(false)
          setActiveCaseDetailError('')
        }}
        isFavorite={activeCase ? favoriteIdSet.has(activeCase.id) : false}
        onToggleFavorite={toggleFavorite}
      />
    </>
  )
}
