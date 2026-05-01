import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  ExportData,
} from './types'
import { DEFAULT_SETTINGS, DEFAULT_PARAMS } from './types'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getImage,
  getAllImages,
  putImage,
  deleteImage,
  clearImages,
  storeImage,
  hashDataUrl,
  buildStoredImageFromBytes,
  migrateStoredImageRecord,
} from './lib/db'
import { callImageApi } from './lib/api'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { normalizeImageSize } from './lib/size'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

// ===== Image cache =====
// 内存缓存，id → dataUrl，避免每次从 IndexedDB 读取

const FULL_IMAGE_CACHE_LIMIT = 32
const PREVIEW_IMAGE_CACHE_LIMIT = 160
const IMAGE_DATA_URL_CACHE_LIMIT = 20
const IMAGE_META_CACHE_LIMIT = 400

const imageFullSrcCache = new Map<string, string>()
const imagePreviewSrcCache = new Map<string, string>()
const imageDataUrlCache = new Map<string, string>()
const imageMetaCache = new Map<string, { width?: number; height?: number }>()

function revokeObjectUrlIfNeeded(src: string | undefined) {
  if (src?.startsWith('blob:')) {
    URL.revokeObjectURL(src)
  }
}

function setLimitedCache(cache: Map<string, string>, id: string, value: string, limit: number) {
  const existing = cache.get(id)
  if (existing && existing !== value) {
    revokeObjectUrlIfNeeded(existing)
  }
  if (existing) {
    cache.delete(id)
  }
  cache.set(id, value)
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) break
    const oldestValue = cache.get(oldestKey)
    cache.delete(oldestKey)
    revokeObjectUrlIfNeeded(oldestValue)
  }
}

function setLimitedMetaCache(id: string, width?: number, height?: number) {
  if (width == null && height == null) return
  if (imageMetaCache.has(id)) imageMetaCache.delete(id)
  imageMetaCache.set(id, { width, height })
  while (imageMetaCache.size > IMAGE_META_CACHE_LIMIT) {
    const oldestKey = imageMetaCache.keys().next().value as string | undefined
    if (!oldestKey) break
    imageMetaCache.delete(oldestKey)
  }
}

export function getCachedImage(
  id: string,
  variant: 'full' | 'preview' = 'full',
  allowCrossVariantFallback = true,
): string | undefined {
  if (variant === 'preview') {
    return allowCrossVariantFallback
      ? imagePreviewSrcCache.get(id) ?? imageFullSrcCache.get(id) ?? imageDataUrlCache.get(id)
      : imagePreviewSrcCache.get(id) ?? imageDataUrlCache.get(id)
  }
  return allowCrossVariantFallback
    ? imageFullSrcCache.get(id) ?? imagePreviewSrcCache.get(id) ?? imageDataUrlCache.get(id)
    : imageFullSrcCache.get(id) ?? imageDataUrlCache.get(id)
}

export function getCachedImageMetadata(id: string): { width?: number; height?: number } | undefined {
  return imageMetaCache.get(id)
}

function clearCachedImage(id: string) {
  revokeObjectUrlIfNeeded(imageFullSrcCache.get(id))
  revokeObjectUrlIfNeeded(imagePreviewSrcCache.get(id))
  imageFullSrcCache.delete(id)
  imagePreviewSrcCache.delete(id)
  imageDataUrlCache.delete(id)
  imageMetaCache.delete(id)
}

function clearAllCachedImages() {
  for (const value of imageFullSrcCache.values()) revokeObjectUrlIfNeeded(value)
  for (const value of imagePreviewSrcCache.values()) revokeObjectUrlIfNeeded(value)
  imageFullSrcCache.clear()
  imagePreviewSrcCache.clear()
  imageDataUrlCache.clear()
  imageMetaCache.clear()
}

async function ensureImageRecord(id: string) {
  const rec = await getImage(id)
  if (rec) {
    setLimitedMetaCache(id, rec.width, rec.height)
  }
  return rec
}

async function ensureImageObjectUrl(id: string, variant: 'full' | 'preview'): Promise<string | undefined> {
  const cache = variant === 'preview' ? imagePreviewSrcCache : imageFullSrcCache
  const limit = variant === 'preview' ? PREVIEW_IMAGE_CACHE_LIMIT : FULL_IMAGE_CACHE_LIMIT
  const cached = cache.get(id)
  if (cached) return cached

  const rec = await ensureImageRecord(id)
  if (!rec) return undefined

  const preferredBlob = variant === 'preview'
    ? rec.previewBlob ?? rec.blob
    : rec.blob ?? rec.previewBlob

  if (preferredBlob) {
    const objectUrl = URL.createObjectURL(preferredBlob)
    setLimitedCache(cache, id, objectUrl, limit)
    return objectUrl
  }

  const legacySrc = rec.dataUrl || rec.src
  if (!legacySrc) return undefined
  setLimitedCache(cache, id, legacySrc, limit)
  if (rec.dataUrl) {
    setLimitedCache(imageDataUrlCache, id, rec.dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
  }
  return legacySrc
}

export async function ensureImageSrc(id: string): Promise<string | undefined> {
  return ensureImageObjectUrl(id, 'full')
}

export async function ensureImagePreviewSrc(id: string): Promise<string | undefined> {
  return ensureImageObjectUrl(id, 'preview')
}

export function ensureOriginalImageSrc(id: string): Promise<string | undefined> {
  return ensureImageSrc(id)
}

export async function ensureImageMetadata(id: string): Promise<{ width?: number; height?: number } | undefined> {
  const cached = imageMetaCache.get(id)
  if (cached) return cached
  const rec = await ensureImageRecord(id)
  if (!rec) return undefined
  return { width: rec.width, height: rec.height }
}

async function fetchImageAsDataUrl(src: string): Promise<string> {
  const response = await fetch(src, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to load image: HTTP ${response.status}`)
  }
  return blobToDataUrl(await response.blob())
}

async function fetchImageBlobWithProxyFallback(src: string): Promise<Blob> {
  try {
    const response = await fetch(src, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.blob()
  } catch (directError) {
    let resolvedUrl: URL
    try {
      resolvedUrl = new URL(src, window.location.href)
    } catch {
      throw directError
    }

    if (!/^https?:$/i.test(resolvedUrl.protocol) || resolvedUrl.origin === window.location.origin) {
      throw directError
    }

    const proxyResponse = await fetch('/api/storage/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'url',
        url: resolvedUrl.toString(),
      }),
    })

    if (!proxyResponse.ok) {
      let detail = `HTTP ${proxyResponse.status}`
      try {
        const payload = await proxyResponse.json() as { error?: string }
        if (payload?.error) detail = payload.error
      } catch {
        /* ignore */
      }
      throw new Error(`本地代理抓取失败: ${detail}`)
    }

    const proxyPayload = await proxyResponse.json() as { url?: string }
    if (!proxyPayload.url) {
      throw new Error('本地代理未返回图片地址')
    }

    const storedResponse = await fetch(proxyPayload.url, { cache: 'no-store' })
    if (!storedResponse.ok) {
      throw new Error(`代理图片读取失败: HTTP ${storedResponse.status}`)
    }

    return await storedResponse.blob()
  }
}

export async function ensureImageDataUrl(id: string): Promise<string | undefined> {
  const cached = imageDataUrlCache.get(id)
  if (cached) return cached

  const rec = await ensureImageRecord(id)
  if (!rec) return undefined

  if (rec.dataUrl) {
    setLimitedCache(imageDataUrlCache, id, rec.dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
    return rec.dataUrl
  }

  if (rec.blob) {
    const dataUrl = await blobToDataUrl(rec.blob)
    setLimitedCache(imageDataUrlCache, id, dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
    return dataUrl
  }

  if (rec.src) {
    const dataUrl = await fetchImageAsDataUrl(rec.src)
    setLimitedCache(imageDataUrlCache, id, dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
    return dataUrl
  }

  return undefined
}

export const ensureImageCached = ensureImageSrc

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

export const TASK_INTERRUPTED_MESSAGE = '任务因页面刷新或应用关闭而中断，请重试'

const pendingTaskIds: string[] = []
let queueFlushScheduled = false

function getTaskRequestedCount(task: Pick<TaskRecord, 'params' | 'requestedCount'>): number {
  const requestedCount = task.requestedCount ?? task.params?.n ?? 1
  return Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : 1
}

function getTaskCompletedCount(task: Pick<TaskRecord, 'outputImages' | 'completedCount'>): number {
  return Math.max(task.completedCount ?? 0, task.outputImages?.length ?? 0)
}

function getTaskFailedCount(task: Pick<TaskRecord, 'failedCount'>, requestedCount: number, completedCount: number): number {
  return Math.max(task.failedCount ?? 0, requestedCount - completedCount)
}

function normalizeRequestedCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PARAMS.n
  return Math.min(4, Math.max(1, Math.trunc(value)))
}

function enqueueTask(taskId: string) {
  if (!pendingTaskIds.includes(taskId)) {
    pendingTaskIds.push(taskId)
  }
  flushTaskQueue()
}

function flushTaskQueue() {
  if (queueFlushScheduled) return
  queueFlushScheduled = true

  queueMicrotask(() => {
    queueFlushScheduled = false

    while (pendingTaskIds.length > 0) {
      const nextTaskId = pendingTaskIds.shift()
      if (!nextTaskId) return

      const task = useStore.getState().tasks.find((item) => item.id === nextTaskId)
      if (!task || task.status !== 'running' || task.executionState !== 'queued') {
        continue
      }

      updateTaskInStore(nextTaskId, {
        executionState: 'processing',
        startedAt: task.startedAt ?? Date.now(),
      })

      void executeTask(nextTaskId).finally(() => {
        flushTaskQueue()
      })
    }
  })
}

// ===== Store 类型 =====

interface AppState {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  pendingImportedInputImageCount: number
  setPendingImportedInputImageCount: (count: number) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void

  // Toast
  toast: { message: string; type: 'info' | 'success' | 'error' } | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    confirmText?: string
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action: () => void
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) => set((st) => ({
        settings: {
          ...st.settings,
          ...s,
          apiMode:
            s.apiMode === 'images' || s.apiMode === 'responses'
              ? s.apiMode
              : st.settings.apiMode ?? DEFAULT_SETTINGS.apiMode,
          codexCli: s.codexCli ?? st.settings.codexCli ?? DEFAULT_SETTINGS.codexCli,
          apiProxy: s.apiProxy ?? st.settings.apiProxy ?? DEFAULT_SETTINGS.apiProxy,
        },
      })),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set({ prompt }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return { inputImages: [...s.inputImages, img] }
        }),
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return {
            inputImages: s.inputImages.filter((_, i) => i !== idx),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) clearCachedImage(img.id)
          return {
            inputImages: [],
            pendingImportedInputImageCount: 0,
            maskDraft: null,
            maskEditorImageId: null,
          }
        }),
      setInputImages: (imgs) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return {
            inputImages,
            pendingImportedInputImageCount: 0,
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      pendingImportedInputImageCount: 0,
      setPendingImportedInputImageCount: (pendingImportedInputImageCount) =>
        set({ pendingImportedInputImageCount: Math.max(0, Math.trunc(pendingImportedInputImageCount)) }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return { inputImages: images }
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => ({
          maskDraft,
          inputImages: orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId),
        })),
      clearMaskDraft: () => set({ maskDraft: null }),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => set({ maskEditorImageId }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => set({ detailTaskId }),
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) =>
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        set({ toast: { message, type } })
        setTimeout(() => {
          set((s) => (s.toast?.message === message ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
    }),
    {
      name: 'gpt-image-playground',
      partialize: (state) => ({
        settings: state.settings,
        params: state.params,
        dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
      }),
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  return `${settings.baseUrl}\n${settings.apiKey}`
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function normalizeParamsForSettings(params: TaskParams, settings: AppSettings): TaskParams {
  return {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    quality: settings.codexCli ? DEFAULT_PARAMS.quality : params.quality,
    n: normalizeRequestedCount(params.n),
  }
}

/** 初始化：从 IndexedDB 加载任务和图片缓存，清理孤立图片 */
export async function initStore(options: { resumeActiveTasks?: boolean } = {}) {
  const tasks = await getAllTasks()
  const now = Date.now()
  const resumeActiveTasks = options.resumeActiveTasks === true
  const normalizedTasks = tasks.map((task) => {
    const requestedCount = getTaskRequestedCount(task)
    const completedCount = getTaskCompletedCount(task)
    const remainingCount = Math.max(0, requestedCount - completedCount)

    if (task.status !== 'running') {
      return {
        ...task,
        requestedCount,
        completedCount,
        failedCount: getTaskFailedCount(task, requestedCount, completedCount),
      }
    }

    if (remainingCount <= 0) {
      return {
        ...task,
        status: 'done' as const,
        executionState: undefined,
        requestedCount,
        completedCount,
        failedCount: 0,
        error: null,
        finishedAt: task.finishedAt ?? now,
        elapsed: task.elapsed ?? Math.max(0, now - (task.startedAt ?? task.createdAt)),
      }
    }

    if (resumeActiveTasks) {
      return {
        ...task,
        status: 'running' as const,
        executionState: 'queued' as const,
        requestedCount,
        completedCount,
        failedCount: task.failedCount ?? 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        elapsed: null,
      }
    }

    return {
      ...task,
      status: 'error' as const,
      executionState: undefined,
      requestedCount,
      completedCount,
      failedCount: getTaskFailedCount(task, requestedCount, completedCount),
      error: TASK_INTERRUPTED_MESSAGE,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
  })
  useStore.getState().setTasks(normalizedTasks)
  await Promise.all(
    normalizedTasks.map((task) =>
      putTask(task).catch((error) => {
        console.error('Failed to normalize task state during init:', error)
      }),
    ),
  )

  // 收集所有任务引用的图片 id
  if (resumeActiveTasks) {
    for (const task of normalizedTasks) {
      if (task.status === 'running' && task.executionState === 'queued') {
        enqueueTask(task.id)
      }
    }
  }

  const referencedIds = new Set<string>()
  for (const t of normalizedTasks) {
    for (const id of t.inputImageIds || []) referencedIds.add(id)
    if (t.maskImageId) referencedIds.add(t.maskImageId)
    for (const id of t.outputImages || []) referencedIds.add(id)
  }

  // 预加载所有图片到缓存，同时清理孤立图片
  const images = await getAllImages()
  for (const img of images) {
    if (!referencedIds.has(img.id)) {
      await deleteImage(img.id)
      continue
    }

    if (!img.blob || !img.previewBlob) {
      try {
        const migrated = await migrateStoredImageRecord(img)
        if (migrated) {
          await putImage(migrated)
        }
      } catch (error) {
        console.warn(`Failed to migrate stored image ${img.id}:`, error)
      }
    }
  }
}

/** 提交新任务 */
async function appendTaskImageResult(
  taskId: string,
  result: {
    image: string
    actualParams?: Partial<TaskParams>
    revisedPrompt?: string
  },
) {
  const imgId = await storeImage(result.image, 'generated')

  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || task.outputImages.includes(imgId)) return

  const outputImages = [...task.outputImages, imgId]
  const actualParamsByImage = { ...(task.actualParamsByImage ?? {}) }
  const revisedPromptByImage = { ...(task.revisedPromptByImage ?? {}) }

  if (result.actualParams && Object.keys(result.actualParams).length > 0) {
    actualParamsByImage[imgId] = result.actualParams
  }
  if (result.revisedPrompt?.trim()) {
    revisedPromptByImage[imgId] = result.revisedPrompt
  }

  updateTaskInStore(taskId, {
    outputImages,
    completedCount: outputImages.length,
    actualParamsByImage: Object.keys(actualParamsByImage).length > 0 ? actualParamsByImage : undefined,
    revisedPromptByImage: Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
  })
}

export async function submitTask(options: { allowFullMask?: boolean } = {}) {
  const { settings, prompt, inputImages, maskDraft, params, showToast, setConfirmDialog } =
    useStore.getState()

  if (!settings.apiKey) {
    showToast('请先在设置中配置 API Key', 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTask({ allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, settings)
  if (
    normalizedParams.size !== params.size ||
    normalizedParams.quality !== params.quality ||
    normalizedParams.n !== params.n
  ) {
    useStore.getState().setParams({
      size: normalizedParams.size,
      quality: normalizedParams.quality,
      n: normalizedParams.n,
    })
  }

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    status: 'running',
    executionState: 'queued',
    requestedCount: normalizeRequestedCount(normalizedParams.n),
    completedCount: 0,
    failedCount: 0,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  try {
    await putTask(task)
  } catch (error) {
    console.error('Failed to persist new task before execution:', error)
    showToast('任务已开始，但本地记录保存失败。', 'error')
  }

  // 异步调用 API
  enqueueTask(taskId)
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return

  try {
    const requestedCount = getTaskRequestedCount(task)
    const completedCountBeforeRun = getTaskCompletedCount(task)
    const remainingCount = Math.max(0, requestedCount - completedCountBeforeRun)

    if (remainingCount <= 0) {
      updateTaskInStore(taskId, {
        status: 'done',
        executionState: undefined,
        completedCount: completedCountBeforeRun,
        failedCount: 0,
        error: null,
        finishedAt: Date.now(),
        elapsed: Date.now() - (task.startedAt ?? task.createdAt),
      })
      return
    }

    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageDataUrl(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageDataUrl(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const result = await callImageApi({
      settings,
      prompt: task.prompt,
      params: { ...task.params, n: remainingCount },
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      onImage: async (partialResult) => {
        await appendTaskImageResult(taskId, {
          image: partialResult.image,
          actualParams: partialResult.actualParams,
          revisedPrompt: partialResult.revisedPrompt,
        })
      },
    })

    // 存储输出图片
    for (let index = 0; index < result.images.length; index += 1) {
      await appendTaskImageResult(taskId, {
        image: result.images[index],
        actualParams: result.actualParamsList?.[index],
        revisedPrompt: result.revisedPrompts?.[index],
      })
    }

    const latestTask = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!latestTask) return

    const outputIds = latestTask.outputImages
    const finalRequestedCount = getTaskRequestedCount(latestTask)
    const completedCount = getTaskCompletedCount(latestTask)
    const failedCount = Math.max(0, finalRequestedCount - completedCount)
    const promptWasRevised = result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== latestTask.prompt.trim(),
    )
    const hasRevisedPromptValue = result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (!settings.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    updateTaskInStore(taskId, {
      actualParams: { ...result.actualParams, n: outputIds.length },
      completedCount,
      failedCount,
      executionState: undefined,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - latestTask.createdAt,
      error: null,
    })

    useStore.getState().showToast(
      failedCount > 0
        ? `已生成 ${completedCount}/${finalRequestedCount} 张图片，${failedCount} 张未返回结果`
        : `生成完成，共 ${outputIds.length} 张图片`,
      failedCount > 0 ? 'info' : 'success',
    )
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    updateTaskInStore(taskId, {
      status: 'error',
      executionState: undefined,
      error: errorMessage,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    useStore.getState().showToast(errorMessage, 'error')
    useStore.getState().setDetailTaskId(taskId)
  }

  // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
  for (const imgId of task.inputImageIds) {
    clearCachedImage(imgId)
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (task) {
    void putTask(task).catch((error) => {
      console.error('Failed to persist task update:', error)
    })
  }
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  const { settings } = useStore.getState()
  const normalizedParams = normalizeParamsForSettings(task.params, settings)
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: normalizedParams,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    outputImages: [],
    status: 'running',
    executionState: 'queued',
    requestedCount: normalizeRequestedCount(normalizedParams.n),
    completedCount: 0,
    failedCount: 0,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  try {
    await putTask(newTask)
  } catch (error) {
    console.error('Failed to persist retry task before execution:', error)
    useStore.getState().showToast('任务已重新开始，但本地记录保存失败。', 'error')
  }

  enqueueTask(taskId)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { setPrompt, setParams, setInputImages, setMaskDraft, clearMaskDraft, showToast } = useStore.getState()
  setPrompt(task.prompt)
  setParams(task.params)

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageDataUrl(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageDataUrl(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  showToast('已复用配置到输入框', 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageDataUrl(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, showToast, clearSelection, selectedTaskIds } = useStore.getState()
  
  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      for (const id of t.inputImageIds || []) deletedImageIds.add(id)
      if (t.maskImageId) deletedImageIds.add(t.maskImageId)
      for (const id of t.outputImages || []) deletedImageIds.add(id)
    }
  }

  setTasks(remaining)
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      clearCachedImage(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 条记录`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, showToast } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      clearCachedImage(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  await dbClearTasks()
  await clearImages()
  clearAllCachedImages()
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()
  setTasks([])
  clearInputImages()
  useStore.setState({ dismissedCodexCliPrompts: [] })
  clearMaskDraft()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  showToast('所有数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

function mimeTypeToExt(mimeType: string | undefined): string {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('png')) return 'png'
  return 'png'
}

async function storedImageToBytes(img: Awaited<ReturnType<typeof getAllImages>>[number]): Promise<{ ext: string; bytes: Uint8Array }> {
  if (img.blob) {
    return {
      ext: mimeTypeToExt(img.blob.type || img.mimeType),
      bytes: new Uint8Array(await img.blob.arrayBuffer()),
    }
  }
  const legacySrc = img.src
  if (legacySrc && (img.srcKind === 'dataUrl' || legacySrc.startsWith('data:'))) {
    return dataUrlToBytes(legacySrc)
  }

  if (!legacySrc) {
    throw new Error('瀵煎嚭鍥剧墖澶辫触: 缺少图片数据')
  }

  const response = await fetch(legacySrc, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`导出图片失败: HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return {
    ext: mimeTypeToExt(blob.type || img.mimeType),
    bytes: new Uint8Array(await blob.arrayBuffer()),
  }
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const { settings } = useStore.getState()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    for (const task of tasks) {
      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
        ...(task.outputImages || []),
      ]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    for (const img of images) {
      const { ext, bytes } = await storedImageToBytes(img)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, createdAt, source: img.source }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    const manifest: ExportData = {
      version: 2,
      exportedAt: new Date(exportedAt).toISOString(),
      settings,
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File) {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const ext = info.path.split('.').pop()?.toLowerCase() ?? 'png'
      const mimeTypeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      }
      const storedImage = await buildStoredImageFromBytes(
        bytes,
        mimeTypeMap[ext] ?? 'image/png',
        info.source ?? 'generated',
        info.createdAt,
        id,
      )
      await putImage(storedImage)
    }

    for (const task of data.tasks) {
      await putTask(task)
    }

    if (data.settings) {
      useStore.getState().setSettings(data.settings)
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(`已导入 ${data.tasks.length} 条记录`, 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 添加图片到输入（文件上传）—— 仅放入内存缓存，不写 IndexedDB */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  const dataUrl = await fileToDataUrl(file)
  const id = await hashDataUrl(dataUrl)
  setLimitedCache(imageFullSrcCache, id, dataUrl, FULL_IMAGE_CACHE_LIMIT)
  setLimitedCache(imagePreviewSrcCache, id, dataUrl, PREVIEW_IMAGE_CACHE_LIMIT)
  setLimitedCache(imageDataUrlCache, id, dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
  useStore.getState().addInputImage({ id, dataUrl })
}

export async function createInputImageFromUrl(src: string): Promise<InputImage> {
  const blob = await fetchImageBlobWithProxyFallback(src)
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')

  const dataUrl = await blobToDataUrl(blob)
  const id = await hashDataUrl(dataUrl)
  setLimitedCache(imageFullSrcCache, id, dataUrl, FULL_IMAGE_CACHE_LIMIT)
  setLimitedCache(imagePreviewSrcCache, id, dataUrl, PREVIEW_IMAGE_CACHE_LIMIT)
  setLimitedCache(imageDataUrlCache, id, dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await hashDataUrl(dataUrl)
  setLimitedCache(imageFullSrcCache, id, dataUrl, FULL_IMAGE_CACHE_LIMIT)
  setLimitedCache(imagePreviewSrcCache, id, dataUrl, PREVIEW_IMAGE_CACHE_LIMIT)
  setLimitedCache(imageDataUrlCache, id, dataUrl, IMAGE_DATA_URL_CACHE_LIMIT)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
