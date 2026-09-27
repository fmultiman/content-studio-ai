'use client'

/**
 * VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1 — editor-only interaction layer over
 * the Live Authoring Player (Select tool).
 *
 * It is a sibling of the Player with the SAME on-screen stage rectangle, never
 * part of the Player/render tree: no handle, outline or hit target reaches
 * FreeSegment, the manifest, a snapshot or the worker. It only reads the
 * authored free boxes and reports new ones through `onBoxChange`, which the
 * page applies with the existing free-composition helpers.
 *
 * Only the free Scene under the playhead is editable, so chrome never spills
 * into a neighbouring Scene interval. Hidden elements, and elements outside
 * their Scene-local timing at this frame (VIDEO_FREE_ELEMENT_TIMING_V1), have
 * no hit target: the Inspector still addresses them.
 *
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: the hit targets, chrome
 * and drag mapping live in `FreeElementsOverlay` (host-agnostic), also used by
 * the Static free canvas. This wrapper only adds the Video concern: which free
 * Scene is under the playhead and which of its elements are active now.
 */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { FreeElementBox, FreeSceneElement, VideoScene } from '@/lib/types'
import { isFreeScene } from '@/lib/creative/video-editor/free-composition'
import { freeElementsActiveAt } from '@/lib/creative/video-editor/element-timing'
import { RESIZE_HANDLES, moveFreeBox, pointerToStage, resizeFreeBox, sameFreeBox, type ResizeHandle, type StagePoint } from '@/lib/creative/video-editor/free-manipulation'
import { sceneIndexAtFrame, type SceneRange } from '@/lib/creative/video-editor/scene-timeline'
import { useFrameCursor, type FrameCursor } from '@/lib/creative/video-editor/frame-cursor'

type Drag = { pointerId: number; elementId: string; handle: ResizeHandle | null; start: StagePoint; box: FreeElementBox; last: FreeElementBox }

const HANDLE_CURSOR: Record<ResizeHandle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }
const HANDLE_POSITION: Record<ResizeHandle, CSSProperties> = {
  nw: { left: -6, top: -6 }, ne: { right: -6, top: -6 }, sw: { left: -6, bottom: -6 }, se: { right: -6, bottom: -6 },
}

const pct = (value: number) => `${value * 100}%`

export function FreeSceneOverlay({ scenes, ranges, cursor, left, top, width, height, selectedElementId, onSelect, onBoxChange, onInteractionStart }: {
  scenes: readonly VideoScene[]
  ranges: readonly SceneRange[]
  cursor: FrameCursor
  /** The on-screen stage rectangle inside the viewport (same values the Player uses). */
  left: number
  top: number
  width: number
  height: number
  selectedElementId: string | null
  /** Selects (sceneId, elementId) or clears the free-element selection. */
  onSelect: (sceneId: string, elementId: string | null) => void
  onBoxChange: (sceneId: string, elementId: string, box: FreeElementBox) => void
  /** Called once per manipulation start (the page pauses playback). */
  onInteractionStart: () => void
}) {
  const frame = useFrameCursor(cursor)
  const index = sceneIndexAtFrame(ranges, frame)
  const scene = index >= 0 ? scenes[index] : undefined
  const free = scene && isFreeScene(scene) ? scene : null
  const range = index >= 0 ? ranges[index] : undefined
  const elements = free && range ? freeElementsActiveAt(free, frame - range.startFrame, range.durationFrames) : []
  return (
    <FreeElementsOverlay
      left={left}
      top={top}
      width={width}
      height={height}
      elements={elements}
      editable={Boolean(free)}
      selectedElementId={selectedElementId}
      onSelect={(elementId) => { if (free) onSelect(free.id, elementId) }}
      onBoxChange={(elementId, box) => { if (free) onBoxChange(free.id, elementId, box) }}
      onInteractionStart={onInteractionStart}
      hostId={free?.id ?? ''}
      hint={scene && !free ? <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white" data-testid="free-overlay-template-hint">Cena com template: edite pelo Inspector</span> : null}
    />
  )
}

/**
 * Host-agnostic direct manipulation over a free composition's stage rectangle:
 * one hit target per (visible, active) element in paint order, the selected
 * element's outline + corner handles, and move/resize mapped through the
 * overlay's live rectangle (= the stage). Reports new boxes only on a real delta.
 */
export function FreeElementsOverlay({ left, top, width, height, elements, editable, selectedElementId, onSelect, onBoxChange, onInteractionStart, hostId, hint }: {
  left: number
  top: number
  width: number
  height: number
  /** Elements that have a hit target now (hidden/inactive ones are excluded by the caller). */
  elements: readonly FreeSceneElement[]
  /** Whether a free composition is under the overlay at all (background clicks clear its selection). */
  editable: boolean
  selectedElementId: string | null
  onSelect: (elementId: string | null) => void
  onBoxChange: (elementId: string, box: FreeElementBox) => void
  onInteractionStart: () => void
  hostId: string
  hint?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  function stagePoint(event: ReactPointerEvent) {
    const rect = rootRef.current?.getBoundingClientRect()
    return rect ? pointerToStage(event.clientX, event.clientY, rect) : { x: 0, y: 0 }
  }

  function begin(event: ReactPointerEvent<HTMLElement>, element: FreeSceneElement, handle: ResizeHandle | null) {
    if (event.button !== 0 || !editable) return
    event.preventDefault()
    event.stopPropagation() // never reaches the viewport pan handlers
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    onInteractionStart()
    onSelect(element.id)
    dragRef.current = { pointerId: event.pointerId, elementId: element.id, handle, start: stagePoint(event), box: element.box, last: element.box }
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !editable) return
    event.stopPropagation()
    const point = stagePoint(event)
    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    const next = drag.handle ? resizeFreeBox(drag.box, drag.handle, dx, dy) : moveFreeBox(drag.box, dx, dy)
    // Only a real geometry delta is an authored edit (a click never dirties the draft).
    if (sameFreeBox(next, drag.last)) return
    drag.last = next
    onBoxChange(drag.elementId, next)
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  return (
    <div
      ref={rootRef}
      className="absolute"
      style={{ left, top, width, height, zIndex: 5, cursor: 'default' }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation() // Select tool: the stage never pans
        if (editable) onSelect(null)
      }}
      data-testid="free-overlay"
      data-scene-id={hostId}
    >
      {hint}
      {elements.map((element, order) => {
        const selected = element.id === selectedElementId
        return (
          <div
            key={element.id}
            className={selected ? 'absolute outline outline-2 outline-sky-500' : 'absolute hover:outline hover:outline-1 hover:outline-sky-400/80'}
            style={{ left: pct(element.box.x), top: pct(element.box.y), width: pct(element.box.width), height: pct(element.box.height), zIndex: order + 1, cursor: 'move', touchAction: 'none' }}
            onPointerDown={(event) => begin(event, element, null)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            data-testid="free-overlay-element"
            data-element-id={element.id}
            data-kind={element.kind}
            data-selected={selected}
            aria-label={element.kind === 'text' ? 'Texto livre' : 'Imagem livre'}
          >
            {selected ? RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className="absolute h-3 w-3 rounded-[2px] border border-sky-600 bg-white shadow"
                style={{ ...HANDLE_POSITION[handle], cursor: HANDLE_CURSOR[handle], touchAction: 'none' }}
                onPointerDown={(event) => begin(event, element, handle)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                data-testid="free-overlay-handle"
                data-handle={handle}
              />
            )) : null}
          </div>
        )
      })}
    </div>
  )
}
