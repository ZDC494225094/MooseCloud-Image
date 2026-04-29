const GALLERY_FAVORITES_STORAGE_KEY = 'moosecloud-gallery-favorite-ids'

export function getStoredGalleryFavoriteIds() {
  if (typeof window === 'undefined') return [] as string[]

  try {
    const raw = window.localStorage.getItem(GALLERY_FAVORITES_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function saveGalleryFavoriteIds(ids: string[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(GALLERY_FAVORITES_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Ignore storage failures so the gallery remains usable.
  }
}
