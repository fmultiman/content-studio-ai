'use client'

/**
 * Creative Editor Video Foundation V1 — TIMELINE view (primary-Scene Timeline Lite).
 *
 * A second VIEW over the same VideoScene[] the CENAS strip edits. Every block
 * is derived (x = startFrame * pixelsPerFrame, width = durationFrames *
 * pixelsPerFrame); zoom, scroll, drag previews and snap guides are local UI
 * state. Only two authoring mutations leave this component, both expressed in
 * existing VideoScene semantics: reorder (array order) and duration (seconds).
 *
 * VIDEO_TIMELINE_GATE_B: below the primary Scenes, one lane per independent
 * item KIND (B-roll · Texto · Áudio). Lanes are a projection of `item.kind`,
 * not persisted Tracks. Items keep their own absolute frames: move = new
 * start_frame, right edge = new duration_frames, both snapped like a Scene
 * edge. Lane row order is layout only; render stacking is decided elsewhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle, Magnet, Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VideoScene } from '@/lib/types'
import { useFrameCursor, type FrameCursor } from '@/lib/creative/video-editor/frame-cursor'
import {
  DEFAULT_PIXELS_PER_FRAME, TIMELINE_FPS, deriveSceneRanges, durationFromRightEdge, fitTimelineZoom, formatSeconds,
  formatTimecode, frameToX, framesToSeconds, reorderTargetIndex, rulerTicks, scrollForAnchoredZoom, secondsToFrames, snapEdgeFrame, snapItemStart,
  stepTimelineZoom, xToFrame,
  type SceneRange,
} from '@/lib/creative/video-editor/scene-timeline'
import { MIN_ITEM_FRAMES, TEMPORAL_LANES, itemEndFrame, type TemporalItem, type TemporalItemKind } from '@/lib/creative/video-editor/temporal-items'

const CONTENT_PAD_LEFT = 12
const CONTENT_PAD_RIGHT = 160
const DRAG_SLOP_PX = 4
const RULER_H = 24
const PRIMARY_TOP = 30
const PRIMARY_H = 44
const LANE_H = 22
const LANE_GAP = 4
const LANES_TOP = PRIMARY_TOP + PRIMARY_H + 6
const CONTENT_H = LANES_TOP + TEMPORAL_LANES.length * (LANE_H + LANE_GAP) + 4
const GUTTER_W = 52

const LANE_STYLE: Record<TemporalItemKind, string> = {
  visual: 'border-sky-500/70 bg-sky-500/20',
  text: 'border-amber-500/70 bg-amber-500/20',
  audio: 'border-emerald-500/70 bg-emerald-500/20',
}

type SceneTimelineProps = {
  scenes: readonly VideoScene[]
  /** The editor's single temporal cursor (read-only here; seeks go through onSeek). */
  cursor: FrameCursor
  playing: boolean
  selectedSceneId: string | null
  thumbnails: Readonly<Record<string, string | undefined>>
  onSeek: (frame: number) => void
  onSelectScene: (sceneId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onDurationChange: (sceneId: string, seconds: number) => void
  /** Gate B: the authored independent layer (absolute frames). */
  items?: readonly TemporalItem[]
  selectedItemId?: string | null
  itemLabel?: (item: TemporalItem) => string
  onSelectItem?: (itemId: string) => void
  onMoveItem?: (itemId: string, startFrame: number) => void
  onResizeItem?: (itemId: string, durationFrames: number) => void
  onAddItem?: (kind: TemporalItemKind) => void
}

type BlockGesture =
  | { kind: 'press'; pointerId: number; index: number; startX: number }
  | { kind: 'reorder'; pointerId: number; index: number; startX: number; dx: number; target: number }
  | { kind: 'trim'; pointerId: number; index: number; frames: number; snappedTo: string | null }
  | { kind: 'item-press'; pointerId: number; id: string; startX: number }
  | { kind: 'item-move'; pointerId: number; id: string; startX: number; frame: number; snappedTo: string | null }
  | { kind: 'item-resize'; pointerId: number; id: string; frames: number; snappedTo: string | null }

export function SceneTimeline({
  scenes, cursor, playing, selectedSceneId, thumbnails, onSeek, onSelectScene, onReorder, onDurationChange,
  items = [], selectedItemId = null, itemLabel = (item) => item.kind, onSelectItem, onMoveItem, onResizeItem, onAddItem,
}: SceneTimelineProps) {
  const [pixelsPerFrame, setPixelsPerFrame] = useState(DEFAULT_PIXELS_PER_FRAME)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gesture, setGesture] = useState<BlockGesture | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const fittedRef = useRef(false)

  // While trimming, downstream Scenes shift live from a LOCAL duration preview; authoring changes on release.
  const previewScenes = useMemo(() => {
    if (gesture?.kind !== 'trim') return scenes
    return scenes.map((scene, index) => (index === gesture.index ? { ...scene, duration: gesture.frames / TIMELINE_FPS } : scene))
  }, [scenes, gesture])
  const ranges = useMemo(() => deriveSceneRanges(previewScenes), [previewScenes])
  const committedRanges = useMemo(() => deriveSceneRanges(scenes), [scenes])
  const totalFrames = ranges.length ? ranges[ranges.length - 1].endFrame : 0
  // Items may reach past the primary sequence (they are clipped in the render); show them whole.
  const itemsEnd = items.reduce((max, item) => Math.max(max, itemEndFrame(item)), 0)
  const contentFrames = Math.max(totalFrames, itemsEnd)
  const contentWidth = CONTENT_PAD_LEFT + frameToX(contentFrames, pixelsPerFrame) + CONTENT_PAD_RIGHT
  const ticks = useMemo(() => rulerTicks(contentFrames, pixelsPerFrame), [contentFrames, pixelsPerFrame])

  // First mount: fit the whole sequence into the visible width (viewport only).
  useEffect(() => {
    const el = scrollerRef.current
    if (fittedRef.current || !el || totalFrames === 0) return
    fittedRef.current = true
    setPixelsPerFrame(fitTimelineZoom(totalFrames, el.clientWidth - CONTENT_PAD_LEFT - 24))
  }, [totalFrames])

  /** Timeline frame under a viewport clientX. */
  const frameAtClientX = useCallback((clientX: number) => {
    const el = scrollerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return xToFrame(clientX - rect.left + el.scrollLeft - CONTENT_PAD_LEFT, pixelsPerFrame)
  }, [pixelsPerFrame])

  const zoomTo = useCallback((next: number, anchorFrame: number) => {
    const el = scrollerRef.current
    const anchorViewportX = el ? CONTENT_PAD_LEFT + frameToX(anchorFrame, pixelsPerFrame) - el.scrollLeft : 0
    setPixelsPerFrame(next)
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = scrollForAnchoredZoom(anchorFrame, anchorViewportX - CONTENT_PAD_LEFT, next)
    })
  }, [pixelsPerFrame])

  // Ctrl/⌘ + wheel = temporal zoom anchored at the pointer; plain wheel keeps native horizontal scroll.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomTo(stepTimelineZoom(pixelsPerFrame, event.deltaY < 0 ? 1 : -1), Math.max(0, frameAtClientX(event.clientX)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [frameAtClientX, pixelsPerFrame, zoomTo])

  // --- Ruler / playhead scrub -------------------------------------------------
  function onScrubDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    capturePointer(event)
    setScrubbing(true)
    onSeek(frameAtClientX(event.clientX))
  }
  function onScrubMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!scrubbing) return
    onSeek(frameAtClientX(event.clientX))
  }
  function onScrubEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setScrubbing(false)
  }

  // --- Block gestures: click = select, horizontal drag = REORDER ---------------
  function onBlockDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    capturePointer(event)
    setGesture({ kind: 'press', pointerId: event.pointerId, index, startX: event.clientX })
  }
  function onBlockMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!gesture || gesture.pointerId !== event.pointerId || (gesture.kind !== 'press' && gesture.kind !== 'reorder')) return
    const dx = event.clientX - gesture.startX
    if (gesture.kind === 'press' && Math.abs(dx) < DRAG_SLOP_PX) return
    const range = committedRanges[gesture.index]
    const centerFrame = range.startFrame + range.durationFrames / 2 + xToFrame(dx, pixelsPerFrame)
    setGesture({ kind: 'reorder', pointerId: gesture.pointerId, index: gesture.index, startX: gesture.startX, dx, target: reorderTargetIndex(committedRanges, gesture.index, centerFrame) })
  }
  function onBlockUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!gesture || gesture.pointerId !== event.pointerId || (gesture.kind !== 'press' && gesture.kind !== 'reorder')) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const scene = scenes[gesture.index]
    if (gesture.kind === 'reorder' && gesture.target !== gesture.index) onReorder(gesture.index, gesture.target)
    else if (scene) onSelectScene(scene.id)
    setGesture(null)
  }

  // --- Right edge = DURATION -------------------------------------------------
  function onTrimDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    capturePointer(event)
    setGesture({ kind: 'trim', pointerId: event.pointerId, index, frames: committedRanges[index].durationFrames, snappedTo: null })
    const scene = scenes[index]
    if (scene) onSelectScene(scene.id)
  }
  function onTrimMove(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture?.kind !== 'trim' || gesture.pointerId !== event.pointerId) return
    const range = committedRanges[gesture.index]
    const edges = committedRanges.filter((_, i) => i !== gesture.index).map((r) => r.endFrame)
    const result = durationFromRightEdge(range, frameAtClientX(event.clientX), {
      pixelsPerFrame, playheadFrame: cursor.get(), edges, disabled: !snapEnabled || event.altKey,
    })
    setGesture({ ...gesture, frames: result.frames, snappedTo: result.snappedTo })
  }
  function onTrimUp(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture?.kind !== 'trim' || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const scene = scenes[gesture.index]
    if (scene && gesture.frames !== secondsToFrames(scene.duration)) onDurationChange(scene.id, framesToSeconds(gesture.frames))
    setGesture(null)
  }

  // --- Independent items (Gate B): body drag = MOVE, right edge = DURATION ---
  /** Snap targets for an item: Scene boundaries + every OTHER item edge (playhead/seconds added by the snapper). */
  function itemEdges(exceptId: string): number[] {
    const edges = new Set<number>()
    for (const range of committedRanges) { edges.add(range.startFrame); edges.add(range.endFrame) }
    for (const item of items) if (item.id !== exceptId) { edges.add(item.start_frame); edges.add(itemEndFrame(item)) }
    return [...edges]
  }
  function onItemDown(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) return
    event.stopPropagation()
    capturePointer(event)
    setGesture({ kind: 'item-press', pointerId: event.pointerId, id, startX: event.clientX })
  }
  function onItemMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!gesture || gesture.pointerId !== event.pointerId || (gesture.kind !== 'item-press' && gesture.kind !== 'item-move')) return
    const dx = event.clientX - gesture.startX
    if (gesture.kind === 'item-press' && Math.abs(dx) < DRAG_SLOP_PX) return
    const item = items.find((candidate) => candidate.id === gesture.id)
    if (!item) return
    const result = snapItemStart(item.start_frame + xToFrame(dx, pixelsPerFrame), item.duration_frames, {
      pixelsPerFrame, playheadFrame: cursor.get(), edges: itemEdges(item.id), disabled: !snapEnabled || event.altKey,
    })
    setGesture({ kind: 'item-move', pointerId: gesture.pointerId, id: gesture.id, startX: gesture.startX, frame: result.frame, snappedTo: result.snappedTo })
  }
  function onItemUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!gesture || gesture.pointerId !== event.pointerId || (gesture.kind !== 'item-press' && gesture.kind !== 'item-move')) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (gesture.kind === 'item-move') onMoveItem?.(gesture.id, gesture.frame)
    onSelectItem?.(gesture.id)
    setGesture(null)
  }
  function onItemResizeDown(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) return
    event.stopPropagation()
    capturePointer(event)
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return
    setGesture({ kind: 'item-resize', pointerId: event.pointerId, id, frames: item.duration_frames, snappedTo: null })
    onSelectItem?.(id)
  }
  function onItemResizeMove(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture?.kind !== 'item-resize' || gesture.pointerId !== event.pointerId) return
    const item = items.find((candidate) => candidate.id === gesture.id)
    if (!item) return
    const snapped = snapEdgeFrame(frameAtClientX(event.clientX), { pixelsPerFrame, playheadFrame: cursor.get(), edges: itemEdges(item.id), disabled: !snapEnabled || event.altKey })
    const frames = Math.max(MIN_ITEM_FRAMES, snapped.frame - item.start_frame)
    setGesture({ ...gesture, frames, snappedTo: frames === snapped.frame - item.start_frame ? snapped.snappedTo : null })
  }
  function onItemResizeUp(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture?.kind !== 'item-resize' || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const item = items.find((candidate) => candidate.id === gesture.id)
    if (item && gesture.frames !== item.duration_frames) onResizeItem?.(gesture.id, gesture.frames)
    setGesture(null)
  }

  const reorderIndicatorX = gesture?.kind === 'reorder' ? CONTENT_PAD_LEFT + frameToX(insertionFrame(committedRanges, gesture.index, gesture.target), pixelsPerFrame) : null
  const guide = gesture?.kind === 'trim'
    ? { x: CONTENT_PAD_LEFT + frameToX(ranges[gesture.index].endFrame, pixelsPerFrame), label: formatSeconds(gesture.frames / TIMELINE_FPS), snappedTo: gesture.snappedTo }
    : gesture?.kind === 'item-move'
      ? { x: CONTENT_PAD_LEFT + frameToX(gesture.frame, pixelsPerFrame), label: formatTimecode(gesture.frame), snappedTo: gesture.snappedTo }
      : gesture?.kind === 'item-resize'
        ? (() => { const item = items.find((candidate) => candidate.id === gesture.id); return item ? { x: CONTENT_PAD_LEFT + frameToX(item.start_frame + gesture.frames, pixelsPerFrame), label: formatSeconds(gesture.frames / TIMELINE_FPS), snappedTo: gesture.snappedTo } : null })()
        : null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-testid="scene-timeline" data-pixels-per-frame={pixelsPerFrame}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Cenas principais</span>
        <span className="inline-flex cursor-help items-center" title="As cenas principais são contíguas: arraste uma cena para reordenar e a borda direita para mudar a duração. B-roll, Texto e Áudio têm tempo próprio: arraste para mover e a borda direita para mudar a duração; eles NÃO acompanham as cenas ao reordenar. Snap em segundos, playhead e bordas (Alt desativa). Ctrl/⌘ + roda = zoom temporal." aria-label="Ajuda da Timeline"><HelpCircle className="h-3.5 w-3.5" aria-hidden="true" /></span>
        {onAddItem ? (
          <div className="flex items-center gap-1" role="group" aria-label="Adicionar item independente">
            {TEMPORAL_LANES.map((lane) => (
              <Button key={lane.kind} size="sm" variant="outline" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => onAddItem(lane.kind)} data-testid="timeline-add-item" data-kind={lane.kind}><Plus className="h-3 w-3" />{lane.label}</Button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Zoom da Timeline">
          <Button size="icon-sm" variant={snapEnabled ? 'secondary' : 'ghost'} onClick={() => setSnapEnabled((value) => !value)} aria-pressed={snapEnabled} aria-label="Snap" title="Snap em segundos inteiros, playhead e bordas (Alt desativa durante o arraste)" data-testid="timeline-snap"><Magnet className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="outline" onClick={() => zoomTo(stepTimelineZoom(pixelsPerFrame, -1), cursor.get())} aria-label="Diminuir zoom da Timeline" title={`Zoom temporal (${Math.round(pixelsPerFrame * TIMELINE_FPS)} px/s)`} data-testid="timeline-zoom-out"><Minus className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="outline" onClick={() => zoomTo(stepTimelineZoom(pixelsPerFrame, 1), cursor.get())} aria-label="Aumentar zoom da Timeline" data-testid="timeline-zoom-in"><Plus className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" onClick={() => { const el = scrollerRef.current; setPixelsPerFrame(fitTimelineZoom(contentFrames, (el?.clientWidth ?? 600) - CONTENT_PAD_LEFT - 24)); if (el) el.scrollLeft = 0 }} aria-label="Ajustar Timeline" title="Ajustar a sequência inteira" data-testid="timeline-fit"><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto border-t border-border/40">
        {/* Lane labels (layout only — never render stacking). */}
        <div className="relative shrink-0 border-r border-border/40 bg-muted/20 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ width: GUTTER_W, height: CONTENT_H }} aria-hidden="true">
          <span className="absolute left-1.5" style={{ top: PRIMARY_TOP + PRIMARY_H / 2 - 6 }}>Cenas</span>
          {TEMPORAL_LANES.map((lane, i) => <span key={lane.kind} className="absolute left-1.5" style={{ top: LANES_TOP + i * (LANE_H + LANE_GAP) + 5 }}>{lane.label}</span>)}
        </div>
        <div ref={scrollerRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden" data-testid="timeline-scroller">
          <div className="relative select-none" style={{ width: contentWidth, height: CONTENT_H }}>
            {/* Ruler: click / drag = scrub */}
            <div
              className={cn('absolute inset-x-0 top-0 border-b border-border/50 bg-muted/40', scrubbing ? 'cursor-grabbing' : 'cursor-pointer')}
              style={{ height: RULER_H }}
              onPointerDown={onScrubDown}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubEnd}
              onPointerCancel={onScrubEnd}
              data-testid="timeline-ruler"
              aria-label="Régua de tempo (clique ou arraste para posicionar o playhead)"
            >
              {ticks.map((tick) => (
                <div key={tick.frame} className="absolute top-0 h-full" style={{ left: CONTENT_PAD_LEFT + tick.x }}>
                  <div className={cn('w-px bg-border', tick.major ? 'h-full' : 'h-2')} />
                  <span className="absolute left-1 top-0.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{tick.label}</span>
                </div>
              ))}
            </div>
            {/* Primary Scene track */}
            <div className="absolute inset-x-0" style={{ top: PRIMARY_TOP, height: PRIMARY_H }} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubEnd} onPointerCancel={onScrubEnd} data-testid="timeline-track">
              {ranges.map((range) => {
                const scene = previewScenes[range.index]
                const dragging = gesture?.kind === 'reorder' && gesture.index === range.index
                const trimming = gesture?.kind === 'trim' && gesture.index === range.index
                const selected = scene.id === selectedSceneId
                const thumb = thumbnails[scene.id]
                return (
                  <div
                    key={scene.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Cena ${range.index + 1}, ${formatSeconds(range.durationFrames / TIMELINE_FPS)}, início ${formatTimecode(range.startFrame)}`}
                    className={cn(
                      'absolute top-0 flex h-full cursor-grab items-stretch overflow-hidden rounded-md border text-left text-[11px] shadow-sm transition-[box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected ? 'border-primary ring-1 ring-primary' : 'border-border/70',
                      dragging ? 'z-20 cursor-grabbing opacity-90 shadow-lg' : 'z-10',
                      trimming ? 'ring-1 ring-amber-500' : '',
                    )}
                    style={{
                      left: CONTENT_PAD_LEFT + frameToX(range.startFrame, pixelsPerFrame),
                      width: Math.max(8, frameToX(range.durationFrames, pixelsPerFrame) - 2),
                      transform: dragging && gesture?.kind === 'reorder' ? `translateX(${gesture.dx}px)` : undefined,
                      background: 'var(--card)',
                    }}
                    onPointerDown={(event) => onBlockDown(event, range.index)}
                    onPointerMove={onBlockMove}
                    onPointerUp={onBlockUp}
                    onPointerCancel={() => setGesture(null)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectScene(scene.id) } }}
                    data-testid="timeline-scene-block"
                    data-scene-id={scene.id}
                    data-start-frame={range.startFrame}
                    data-duration-frames={range.durationFrames}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed display URL
                      <img src={thumb} alt="" className="h-full w-9 shrink-0 object-cover opacity-80" draggable={false} />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col justify-center px-2">
                      <span className="truncate font-medium text-foreground">Cena {range.index + 1}</span>
                      <span className="truncate tabular-nums text-muted-foreground">{formatSeconds(range.durationFrames / TIMELINE_FPS)}</span>
                    </div>
                    <div
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-primary/0 hover:bg-primary/40"
                      onPointerDown={(event) => onTrimDown(event, range.index)}
                      onPointerMove={onTrimMove}
                      onPointerUp={onTrimUp}
                      onPointerCancel={() => setGesture(null)}
                      aria-label={`Ajustar duração da cena ${range.index + 1}`}
                      data-testid="timeline-trim-handle"
                    />
                  </div>
                )
              })}
            </div>
            {/* Independent lanes (Gate B): one per item kind. */}
            {TEMPORAL_LANES.map((lane, laneIndex) => (
              <div
                key={lane.kind}
                className="absolute inset-x-0 border-y border-dashed border-border/30"
                style={{ top: LANES_TOP + laneIndex * (LANE_H + LANE_GAP), height: LANE_H }}
                onPointerDown={onScrubDown}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubEnd}
                onPointerCancel={onScrubEnd}
                data-testid="timeline-lane"
                data-kind={lane.kind}
              >
                {items.filter((item) => item.kind === lane.kind).map((item) => {
                  const moving = gesture?.kind === 'item-move' && gesture.id === item.id ? gesture.frame : null
                  const resizing = gesture?.kind === 'item-resize' && gesture.id === item.id ? gesture.frames : null
                  const start = moving ?? item.start_frame
                  const duration = resizing ?? item.duration_frames
                  const selected = item.id === selectedItemId
                  const pastEnd = start + duration > totalFrames
                  const label = itemLabel(item)
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      aria-label={`${lane.label}: ${label}, início ${formatTimecode(start)}, ${formatSeconds(duration / TIMELINE_FPS)}`}
                      title={pastEnd ? 'Passa do fim do vídeo: a parte excedente não entra no render.' : undefined}
                      className={cn(
                        'absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        LANE_STYLE[lane.kind],
                        selected ? 'z-20 ring-1 ring-primary' : 'z-10',
                        moving !== null ? 'cursor-grabbing opacity-90 shadow' : '',
                        pastEnd ? 'border-r-2 border-r-destructive' : '',
                      )}
                      style={{ left: CONTENT_PAD_LEFT + frameToX(start, pixelsPerFrame), width: Math.max(8, frameToX(duration, pixelsPerFrame) - 1) }}
                      onPointerDown={(event) => onItemDown(event, item.id)}
                      onPointerMove={onItemMove}
                      onPointerUp={onItemUp}
                      onPointerCancel={() => setGesture(null)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectItem?.(item.id) } }}
                      data-testid="timeline-item"
                      data-item-id={item.id}
                      data-kind={item.kind}
                      data-start-frame={item.start_frame}
                      data-duration-frames={item.duration_frames}
                    >
                      <span className="truncate">{label}</span>
                      <div
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-primary/40"
                        onPointerDown={(event) => onItemResizeDown(event, item.id)}
                        onPointerMove={onItemResizeMove}
                        onPointerUp={onItemResizeUp}
                        onPointerCancel={() => setGesture(null)}
                        aria-label={`Ajustar duração de ${label}`}
                        data-testid="timeline-item-resize"
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            {/* End of the primary sequence: independent items are clipped here in the render. */}
            {itemsEnd > totalFrames ? <div className="pointer-events-none absolute bottom-0 z-30 w-px bg-destructive/60" style={{ top: LANES_TOP, left: CONTENT_PAD_LEFT + frameToX(totalFrames, pixelsPerFrame) }} data-testid="timeline-sequence-end" /> : null}
            {reorderIndicatorX !== null ? <div className="pointer-events-none absolute bottom-1 z-30 w-0.5 bg-primary" style={{ top: PRIMARY_TOP - 2, left: reorderIndicatorX - 1 }} data-testid="timeline-reorder-indicator" /> : null}
            {guide ? (
              <div className="pointer-events-none absolute bottom-0 top-6 z-30 w-px bg-amber-500" style={{ left: guide.x }} data-testid="timeline-snap-guide" data-snapped-to={guide.snappedTo ?? ''}>
                <span className="absolute -top-0.5 left-1 whitespace-nowrap rounded bg-amber-500 px-1 text-[10px] text-black">
                  {`${guide.label}${guide.snappedTo ? ` · snap ${snapLabel(guide.snappedTo)}` : ''}`}
                </span>
              </div>
            ) : null}
            <TimelinePlayhead cursor={cursor} pixelsPerFrame={pixelsPerFrame} playing={playing} scrollerRef={scrollerRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Playhead: the only part of the Timeline that follows the cursor every frame. */
function TimelinePlayhead({ cursor, pixelsPerFrame, playing, scrollerRef }: { cursor: FrameCursor; pixelsPerFrame: number; playing: boolean; scrollerRef: React.RefObject<HTMLDivElement | null> }) {
  const frame = useFrameCursor(cursor)
  const x = CONTENT_PAD_LEFT + frameToX(frame, pixelsPerFrame)
  // Playback keeps the playhead in view (scroll is viewport state, never authoring).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !playing) return
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - 48)
  }, [x, playing, scrollerRef])
  return (
    <div className="pointer-events-none absolute top-0 z-40 h-full" style={{ left: x }} data-testid="timeline-playhead" data-frame={frame}>
      <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 bg-red-500" />
      <div className="absolute left-0 top-0 h-full w-px bg-red-500" />
    </div>
  )
}

/** Pointer capture keeps a drag alive outside the element; a pointer that is no longer active cannot be captured (harmless). */
function capturePointer(event: React.PointerEvent<HTMLElement>) {
  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
}

function snapLabel(kind: string): string {
  return kind === 'playhead' ? 'playhead' : kind === 'scene-edge' ? 'borda' : '1s'
}

/** Frame where the dragged Scene would be inserted, in the sequence without it. */
function insertionFrame(ranges: readonly SceneRange[], fromIndex: number, target: number): number {
  let frame = 0
  let slot = 0
  for (let i = 0; i < ranges.length; i++) {
    if (i === fromIndex) continue
    if (slot === target) return frame
    frame += ranges[i].durationFrames
    slot++
  }
  return frame
}
