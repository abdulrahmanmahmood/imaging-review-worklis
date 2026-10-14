'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  Enums,
  RenderingEngine,
  cache,
  imageLoader,
  init as coreInit,
  metaData,
  type StackViewport,
  type Types,
} from '@cornerstonejs/core'
import { init as dicomImageLoaderInit, wadouri } from '@cornerstonejs/dicom-image-loader'
import {
  Enums as ToolEnums,
  ToolGroupManager,
  WindowLevelTool,
  addTool,
  init as toolsInit,
} from '@cornerstonejs/tools'

export type DicomMeta = {
  modality: string
  studyDate: string
  columns: number
  rows: number
}

type VoiState = { center: number; width: number; min: number; max: number }

type LoadState =
  | { tag: 'loading' }
  | { tag: 'loaded'; meta: DicomMeta }
  | { tag: 'error'; message: string }

// Observable lifecycle counters, used by the lifecycle test to detect leaks.
export const viewerStats = { engines: 0, toolGroups: 0, resizeObservers: 0, voiListeners: 0 }
if (typeof window !== 'undefined') {
  ;(window as unknown as { __viewerStats: typeof viewerStats }).__viewerStats = viewerStats
}

let initPromise: Promise<void> | null = null

function ensureCornerstone(): Promise<void> {
  initPromise ??= (async () => {
    // One viewport needs one WebGL context; the default pool of 7 per engine exhausts the browser limit.
    coreInit({ rendering: { webGlContextCount: 1 }, debug: {} })
    dicomImageLoaderInit({ maxWebWorkers: 1 })
    wadouri.register()
    toolsInit()
    addTool(WindowLevelTool)
  })().catch((error: unknown) => {
    initPromise = null
    throw error
  })
  return initPromise
}

function formatDicomDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function readMeta(imageId: string, image: Types.IImage): DicomMeta {
  const series = metaData.get('generalSeriesModule', imageId) as { modality?: string } | undefined
  const study = metaData.get('generalStudyModule', imageId) as { studyDate?: string } | undefined
  return {
    modality: series?.modality ?? '',
    studyDate: formatDicomDate(study?.studyDate),
    columns: image.columns,
    rows: image.rows,
  }
}

function describeLoadError(error: unknown): string {
  const status = (error as { request?: { status?: number } } | null)?.request?.status
  if (status === 404) return 'The image file for this study was not found.'
  if (status && status >= 400) return `The image could not be downloaded (HTTP ${status}).`
  return 'This DICOM file could not be decoded. It may be corrupt or use an unsupported format.'
}

export function DicomViewer({ studyId, apiBase }: { studyId: string; apiBase: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const engineId = `engine-${uid}`
  const viewportId = `viewport-${uid}`
  const toolGroupId = `tools-${uid}`

  const elementRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<StackViewport | null>(null)
  const readyRef = useRef<Promise<StackViewport | null> | null>(null)

  // View state is keyed by study ID, so a different study is implicitly "loading".
  const [view, setView] = useState<{ studyId: string; load: LoadState; voi: VoiState | null } | null>(null)
  const current = view?.studyId === studyId ? view : null
  const loadState: LoadState = current?.load ?? { tag: 'loading' }
  const voi = current?.voi ?? null

  const syncVoiFromViewport = useCallback(() => {
    const viewport = viewportRef.current
    const range = viewport?.getProperties().voiRange
    if (!viewport || !range) return
    setView((prev) =>
      prev?.voi
        ? {
            ...prev,
            voi: {
              ...prev.voi,
              center: Math.round((range.lower + range.upper) / 2),
              width: Math.max(1, Math.round(range.upper - range.lower)),
            },
          }
        : prev,
    )
  }, [])

  // Engine, viewport, tools and observers live for the lifetime of this component.
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    let disposed = false
    let engine: RenderingEngine | null = null
    let observer: ResizeObserver | null = null

    const onVoiModified = () => syncVoiFromViewport()

    readyRef.current = ensureCornerstone().then(() => {
      if (disposed) return null
      engine = new RenderingEngine(engineId)
      viewerStats.engines++
      engine.enableElement({ viewportId, element, type: Enums.ViewportType.STACK })

      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId)
      if (toolGroup) {
        viewerStats.toolGroups++
        toolGroup.addTool(WindowLevelTool.toolName)
        toolGroup.addViewport(viewportId, engineId)
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        })
      }

      element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified)
      viewerStats.voiListeners++

      observer = new ResizeObserver(() => engine?.resize(true, true))
      observer.observe(element)
      viewerStats.resizeObservers++

      const viewport = engine.getViewport(viewportId) as StackViewport
      viewportRef.current = viewport
      return viewport
    })

    return () => {
      disposed = true
      viewportRef.current = null
      readyRef.current = null
      if (observer) {
        observer.disconnect()
        viewerStats.resizeObservers--
      }
      if (engine) {
        element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified)
        viewerStats.voiListeners--
        if (ToolGroupManager.getToolGroup(toolGroupId)) {
          ToolGroupManager.destroyToolGroup(toolGroupId)
          viewerStats.toolGroups--
        }
        engine.destroy()
        viewerStats.engines--
      }
    }
  }, [engineId, viewportId, toolGroupId, syncVoiFromViewport])

  // Load the current study. Only the latest request may touch the viewport.
  useEffect(() => {
    let cancelled = false
    const isCurrent = () => !cancelled
    const imageId = `wadouri:${apiBase.replace(/\/+$/, '')}/api/studies/${encodeURIComponent(studyId)}/file`

    void (async () => {
      try {
        const viewport = await readyRef.current
        if (!viewport || !isCurrent()) return

        // loadAndCacheImage leaves an unhandled rejection inside Cornerstone's cache for corrupt files,
        // so load uncached (rejection handled here) and cache only images that decoded successfully.
        const image = await imageLoader.loadImage(imageId)
        if (!cache.getImageLoadObject(imageId)) cache.putImageSync(imageId, image)
        if (!isCurrent()) return

        await viewport.setStack([imageId])
        if (!isCurrent()) return

        viewport.resetCamera()
        viewport.render()

        const range = viewport.getProperties().voiRange
        const min = image.minPixelValue
        const max = image.maxPixelValue
        setView({
          studyId,
          load: { tag: 'loaded', meta: readMeta(imageId, image) },
          voi: {
            center: Math.round(range ? (range.lower + range.upper) / 2 : (min + max) / 2),
            width: Math.max(1, Math.round(range ? range.upper - range.lower : max - min)),
            min,
            max,
          },
        })
      } catch (error) {
        if (!isCurrent()) return
        setView({ studyId, load: { tag: 'error', message: describeLoadError(error) }, voi: null })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [studyId, apiBase])

  const applyVoi = useCallback((center: number, width: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const safeWidth = Math.max(1, width)
    viewport.setProperties({ voiRange: { lower: center - safeWidth / 2, upper: center + safeWidth / 2 } })
    viewport.render()
    setView((prev) => (prev?.voi ? { ...prev, voi: { ...prev.voi, center, width: safeWidth } } : prev))
  }, [])

  const reset = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.resetProperties()
    viewport.resetCamera()
    viewport.render()
    syncVoiFromViewport()
  }, [syncVoiFromViewport])

  const loaded = loadState.tag === 'loaded'
  const span = voi ? Math.max(1, voi.max - voi.min) : 1

  return (
    <section aria-label="DICOM image viewer" className="flex flex-col gap-2">
      {loaded && (
        <dl className="flex flex-wrap gap-x-4 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex gap-1">
            <dt>Modality:</dt>
            <dd>{loadState.meta.modality || '—'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Study date:</dt>
            <dd>{loadState.meta.studyDate || '—'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Dimensions:</dt>
            <dd data-testid="viewer-dimensions">
              {loadState.meta.columns} × {loadState.meta.rows}
            </dd>
          </div>
        </dl>
      )}

      <div className="relative h-[400px] w-full resize-y overflow-hidden rounded border bg-black">
        <div
          ref={elementRef}
          data-testid="viewer-canvas"
          className="h-full w-full"
          style={{ touchAction: 'none', visibility: loaded ? 'visible' : 'hidden' }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {loadState.tag === 'loading' && (
          <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300">
            Loading DICOM image…
          </p>
        )}
        {loadState.tag === 'error' && (
          <p
            role="alert"
            className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-300"
          >
            {loadState.message}
          </p>
        )}
      </div>

      {loaded && voi && (
        <div className="flex flex-wrap items-end gap-4 text-xs">
          <label className="flex flex-col gap-1">
            Window width: {voi.width}
            <input
              type="range"
              min={1}
              max={Math.max(span * 2, voi.width)}
              value={voi.width}
              onChange={(e) => applyVoi(voi.center, Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            Window center: {voi.center}
            <input
              type="range"
              min={Math.min(voi.min - span, voi.center)}
              max={Math.max(voi.max + span, voi.center)}
              value={voi.center}
              onChange={(e) => applyVoi(Number(e.target.value), voi.width)}
            />
          </label>
          <button type="button" className="rounded border px-3 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={reset}>
            Fit / Reset
          </button>
          <span className="text-zinc-500">Drag on the image to adjust window/level.</span>
        </div>
      )}
    </section>
  )
}
