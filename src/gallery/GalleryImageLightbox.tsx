import { useCallback, useEffect, useRef, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

const MIN_SCALE = 1
const MAX_SCALE = 10

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function GalleryImageLightbox({
  images,
  index,
  onClose,
}: {
  images: string[]
  index: number
  onClose: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(index)
  const [, forceRender] = useState(0)
  const [showZoomBadge, setShowZoomBadge] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    baseTx: 0,
    baseTy: 0,
  })
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    midX: 0,
    midY: 0,
  })
  const tapRef = useRef({ time: 0, x: 0, y: 0 })
  const hadMultiTouchRef = useRef(false)
  const touchStartedOnImageRef = useRef(false)
  const didDragRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  useCloseOnEscape(true, onClose)

  const rerender = useCallback(() => forceRender((value) => value + 1), [])

  const resetTransform = useCallback(() => {
    scaleRef.current = 1
    txRef.current = 0
    tyRef.current = 0
    setShowZoomBadge(false)
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    rerender()
  }, [rerender])

  useEffect(() => {
    setActiveIndex(index)
    resetTransform()
  }, [index, resetTransform])

  useEffect(() => {
    const suppressClick = () => {
      suppressNextClickRef.current = true
    }

    window.addEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
    return () => window.removeEventListener('image-context-menu-dismiss-lightbox-click', suppressClick)
  }, [])

  useEffect(() => {
    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    }
  }, [])

  const activeImage = images[activeIndex] || ''
  const showNav = images.length > 1

  const apply = useCallback((scale: number, tx: number, ty: number) => {
    const nextScale = clamp(scale, MIN_SCALE, MAX_SCALE)
    scaleRef.current = nextScale
    txRef.current = nextScale <= 1 ? 0 : tx
    tyRef.current = nextScale <= 1 ? 0 : ty

    if (nextScale > 1) {
      setShowZoomBadge(true)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => setShowZoomBadge(false), 1500)
    } else {
      setShowZoomBadge(false)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    }

    rerender()
  }, [rerender])

  const getCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { cx: 0, cy: 0 }
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  }, [])

  const previous = useCallback(() => {
    setActiveIndex((value) => (value - 1 + images.length) % images.length)
    resetTransform()
  }, [images.length, resetTransform])

  const next = useCallback(() => {
    setActiveIndex((value) => (value + 1) % images.length)
    resetTransform()
  }, [images.length, resetTransform])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const scale = scaleRef.current
      const tx = txRef.current
      const ty = tyRef.current
      const rect = el.getBoundingClientRect()
      const mx = event.clientX - rect.left - rect.width / 2
      const my = event.clientY - rect.top - rect.height / 2
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
      const ratio = nextScale / scale
      apply(nextScale, mx - ratio * (mx - tx), my - ratio * (my - ty))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      didDragRef.current = false
      if (scaleRef.current <= 1) return
      event.preventDefault()
      dragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        baseTx: txRef.current,
        baseTy: tyRef.current,
      }
    }

    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag.active) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true
      apply(scaleRef.current, drag.baseTx + dx, drag.baseTy + dy)
    }

    const onUp = () => {
      dragRef.current.active = false
    }

    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [apply])

  useEffect(() => {
    if (!showNav) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, previous, showNav])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault()
        hadMultiTouchRef.current = true
        tapRef.current = { time: 0, x: 0, y: 0 }
        const [a, b] = [event.touches[0], event.touches[1]]
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const { cx, cy } = getCenter()
        pinchRef.current = {
          active: true,
          startDist: distance,
          startScale: scaleRef.current,
          startTx: txRef.current,
          startTy: tyRef.current,
          midX: (a.clientX + b.clientX) / 2 - cx,
          midY: (a.clientY + b.clientY) / 2 - cy,
        }
        dragRef.current.active = false
      } else if (event.touches.length === 1) {
        const touch = event.touches[0]
        const now = Date.now()
        const previousTap = tapRef.current
        touchStartedOnImageRef.current = event.target instanceof HTMLImageElement

        if (
          now - previousTap.time < 300 &&
          Math.abs(touch.clientX - previousTap.x) < 30 &&
          Math.abs(touch.clientY - previousTap.y) < 30
        ) {
          event.preventDefault()
          if (scaleRef.current > 1) {
            resetTransform()
          } else {
            const { cx, cy } = getCenter()
            const mx = touch.clientX - cx
            const my = touch.clientY - cy
            apply(3, -mx * 2, -my * 2)
          }
          tapRef.current = { time: 0, x: 0, y: 0 }
          return
        }

        tapRef.current = { time: now, x: touch.clientX, y: touch.clientY }

        if (scaleRef.current > 1 && touchStartedOnImageRef.current) {
          event.preventDefault()
          dragRef.current = {
            active: true,
            startX: touch.clientX,
            startY: touch.clientY,
            baseTx: txRef.current,
            baseTy: tyRef.current,
          }
        }
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (pinchRef.current.active && event.touches.length === 2) {
        event.preventDefault()
        const [a, b] = [event.touches[0], event.touches[1]]
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const pinch = pinchRef.current
        const nextScale = clamp(pinch.startScale * (distance / pinch.startDist), MIN_SCALE, MAX_SCALE)
        const ratio = nextScale / pinch.startScale
        apply(
          nextScale,
          pinch.midX - ratio * (pinch.midX - pinch.startTx),
          pinch.midY - ratio * (pinch.midY - pinch.startTy),
        )
      } else if (dragRef.current.active && event.touches.length === 1) {
        event.preventDefault()
        const touch = event.touches[0]
        const drag = dragRef.current
        apply(
          scaleRef.current,
          drag.baseTx + touch.clientX - drag.startX,
          drag.baseTy + touch.clientY - drag.startY,
        )
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchRef.current.active = false
      if (event.touches.length === 0) {
        dragRef.current.active = false
        if (hadMultiTouchRef.current) {
          hadMultiTouchRef.current = false
          tapRef.current = { time: 0, x: 0, y: 0 }
          return
        }

        if (scaleRef.current <= 1 || !touchStartedOnImageRef.current) {
          const tap = tapRef.current
          if (tap.time > 0 && Date.now() - tap.time < 300) {
            setTimeout(() => {
              if (tapRef.current.time === tap.time) onClose()
            }, 310)
          }
        }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [apply, getCenter, onClose, resetTransform])

  const onClick = useCallback((event: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      event.stopPropagation()
      return
    }
    if (didDragRef.current) return
    if (scaleRef.current > 1 && event.target instanceof HTMLImageElement) return
    onClose()
  }, [onClose])

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (scaleRef.current > 1) {
      resetTransform()
    } else {
      const { cx, cy } = getCenter()
      const mx = event.clientX - cx
      const my = event.clientY - cy
      apply(3, -mx * 2, -my * 2)
    }
  }, [apply, getCenter, resetTransform])

  const scale = scaleRef.current
  const tx = txRef.current
  const ty = tyRef.current
  const isZoomed = scale > 1
  const isDragging = dragRef.current.active || pinchRef.current.active
  const zoomPercent = Math.round(scale * 100)
  const navBtnClass =
    'absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-all z-10 backdrop-blur-sm'

  return (
    <div
      ref={containerRef}
      data-lightbox-root
      className="fixed inset-0 z-[70] flex items-center justify-center select-none"
      style={{ cursor: isZoomed ? (isDragging ? 'grabbing' : 'grab') : 'pointer' }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in" />
      <div className="relative animate-zoom-in">
        <div
          className="relative flex items-center justify-center"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            willChange: 'transform',
          }}
        >
          <img
            src={activeImage}
            alt=""
            className="max-w-[85vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onDragStart={(event) => event.preventDefault()}
          />
        </div>
      </div>

      {showNav && !isZoomed && (
        <>
          <button
            className={`${navBtnClass} left-3 sm:left-5`}
            onClick={(event) => {
              event.stopPropagation()
              previous()
            }}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className={`${navBtnClass} right-3 sm:right-5`}
            onClick={(event) => {
              event.stopPropagation()
              next()
            }}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {showZoomBadge && isZoomed && zoomPercent !== 100 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="px-3 py-1.5 bg-black/50 text-white/80 text-xs rounded-full backdrop-blur-sm transition-opacity duration-500">
            {zoomPercent}%
          </span>
        </div>
      )}

      {showNav && !isZoomed && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="px-3 py-1.5 bg-black/50 text-white/80 text-xs rounded-full backdrop-blur-sm">
            {activeIndex + 1} / {images.length}
          </span>
        </div>
      )}
    </div>
  )
}
