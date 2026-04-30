import type { TaskRecord, StoredImage } from '../types'

const DB_NAME = 'gpt-image-playground'
const DB_VERSION = 2
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const PREVIEW_MAX_EDGE = 320
const PREVIEW_QUALITY = 0.82

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//i.test(value)
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function isBlobUrl(value: unknown): value is string {
  return typeof value === 'string' && /^blob:/i.test(value)
}

function toPlainArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to decode image blob'))
    }
    image.src = objectUrl
  })
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Failed to create image blob'))
      else resolve(blob)
    }, type, quality)
  })
}

async function normalizeIncomingImageBlob(blob: Blob): Promise<Blob> {
  if (blob.type.startsWith('image/')) return blob
  return new Blob([await blob.arrayBuffer()], { type: 'image/png' })
}

async function imageRefToBlob(imageRef: string): Promise<Blob> {
  if (!isDataUrl(imageRef) && !isHttpUrl(imageRef) && !isBlobUrl(imageRef)) {
    throw new Error('Unsupported image reference')
  }

  const response = await fetch(imageRef, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Failed to read image: HTTP ${response.status}`)
  }
  return normalizeIncomingImageBlob(await response.blob())
}

async function createPreviewBlob(blob: Blob): Promise<{ previewBlob: Blob; width: number; height: number }> {
  const image = await loadImageFromBlob(blob)
  const width = image.naturalWidth
  const height = image.naturalHeight
  const maxEdge = Math.max(width, height)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }

  if (maxEdge <= PREVIEW_MAX_EDGE) {
    return { previewBlob: blob, width, height }
  }

  const scale = PREVIEW_MAX_EDGE / maxEdge
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Current browser does not support Canvas')

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
  const previewType = blob.type === 'image/png' ? 'image/jpeg' : blob.type
  const previewBlob = await canvasToBlob(canvas, previewType, PREVIEW_QUALITY)
  return { previewBlob, width, height }
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    let h1 = 0x811c9dc5
    let h2 = 0x01000193

    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i]
      h1 ^= code
      h1 = Math.imul(h1, 0x01000193)
      h2 ^= code
      h2 = Math.imul(h2, 0x27d4eb2d)
    }

    return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', toPlainArrayBuffer(bytes))
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function buildStoredImageFromBlob(
  blob: Blob,
  source: NonNullable<StoredImage['source']>,
  createdAt = Date.now(),
  forcedId?: string,
): Promise<StoredImage> {
  const normalizedBlob = await normalizeIncomingImageBlob(blob)
  const bytes = new Uint8Array(await normalizedBlob.arrayBuffer())
  const id = forcedId ?? await hashBytes(bytes)
  const { previewBlob, width, height } = await createPreviewBlob(normalizedBlob)

  return {
    id,
    blob: normalizedBlob,
    previewBlob,
    width,
    height,
    mimeType: normalizedBlob.type || previewBlob.type || 'image/png',
    createdAt,
    source,
  }
}

export async function migrateStoredImageRecord(
  image: Partial<StoredImage> | undefined | null,
): Promise<StoredImage | undefined> {
  const normalized = normalizeStoredImage(image)
  if (!normalized) return undefined
  if (normalized.blob && normalized.previewBlob) return normalized

  const source = normalized.source ?? 'generated'
  if (normalized.blob) {
    return buildStoredImageFromBlob(normalized.blob, source, normalized.createdAt, normalized.id)
  }

  const legacyRef = normalized.dataUrl || normalized.src
  if (!legacyRef) return normalized

  const blob = await imageRefToBlob(legacyRef)
  return buildStoredImageFromBlob(blob, source, normalized.createdAt, normalized.id)
}

function normalizeStoredImage(image: Partial<StoredImage> | undefined | null): StoredImage | undefined {
  if (!image?.id) return undefined

  if (image.blob || image.previewBlob) {
    return {
      id: image.id,
      blob: image.blob,
      previewBlob: image.previewBlob,
      width: image.width,
      height: image.height,
      src: image.src,
      srcKind: image.srcKind,
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      createdAt: image.createdAt,
      source: image.source,
    }
  }

  const legacyDataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : ''
  const legacySrc = typeof image.src === 'string' ? image.src : ''
  if (!legacyDataUrl && !legacySrc) return undefined

  return {
    id: image.id,
    src: legacySrc || legacyDataUrl,
    srcKind: image.srcKind ?? (isDataUrl(legacyDataUrl || legacySrc) ? 'dataUrl' : 'url'),
    dataUrl: legacyDataUrl || undefined,
    mimeType: image.mimeType,
    createdAt: image.createdAt,
    source: image.source,
  }
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== Images =====

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const record = await dbTransaction<StoredImage | undefined>(STORE_IMAGES, 'readonly', (s) => s.get(id))
  return normalizeStoredImage(record)
}

export async function getAllImages(): Promise<StoredImage[]> {
  const records = await dbTransaction<Array<StoredImage | undefined>>(STORE_IMAGES, 'readonly', (s) => s.getAll())
  return records
    .map((record) => normalizeStoredImage(record))
    .filter((record): record is StoredImage => Boolean(record))
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  const normalized = normalizeStoredImage(image)
  if (!normalized) {
    throw new Error('Invalid image record')
  }
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(normalized))
}

export function deleteImage(id: string): Promise<undefined> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.delete(id))
}

export function clearImages(): Promise<undefined> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.clear())
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    let h1 = 0x811c9dc5
    let h2 = 0x01000193

    for (let i = 0; i < dataUrl.length; i++) {
      const code = dataUrl.charCodeAt(i)
      h1 ^= code
      h1 = Math.imul(h1, 0x01000193)
      h2 ^= code
      h2 = Math.imul(h2, 0x27d4eb2d)
    }

    return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function storeImage(
  imageRef: string,
  source: NonNullable<StoredImage['source']> = 'upload',
): Promise<string> {
  const blob = await imageRefToBlob(imageRef)
  const image = await buildStoredImageFromBlob(blob, source)
  const existing = await getImage(image.id)
  if (!existing) {
    await putImage(image)
  }
  return image.id
}

export async function buildStoredImageFromBytes(
  bytes: Uint8Array,
  mimeType: string,
  source: NonNullable<StoredImage['source']>,
  createdAt = Date.now(),
  forcedId?: string,
): Promise<StoredImage> {
  const arrayBuffer = toPlainArrayBuffer(bytes)
  const blob = new Blob([arrayBuffer], { type: mimeType || 'image/png' })
  return buildStoredImageFromBlob(blob, source, createdAt, forcedId)
}
