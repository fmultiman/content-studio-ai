/**
 * VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1 — Scene-local element timing.
 *
 * WHEN a Template element participates inside its Scene. It is owned by the
 * Scene (`VideoScene.element_timing`), expressed in Scene-LOCAL frames, and
 * only for elements the layout declares temporal (`TemplateElementDefinition.timing`).
 * Every other element keeps being full-Scene spatial composition.
 *
 *  - Timing != visibility: a hidden element (Camadas) never draws, whatever its timing.
 *  - Timing != Motion: Motion is HOW the whole Scene moves; timing is only WHEN an element is present.
 *  - Global placement is DERIVED: globalFrame = sceneStartFrame + localFrame. Reordering or
 *    retiming other Scenes never rewrites these values.
 *  - Scene shorter than an authored range: the authored value is kept; the EFFECTIVE range is
 *    clipped at the Scene end (and reported), never mutated.
 *
 * Pure: no React, no Remotion. The adapter derives the neutral per-segment ranges from here;
 * the renderer only evaluates them against the Scene-local frame.
 */
import type { VideoScene, VideoSceneElementTiming, VideoSceneElementTimingMap } from '@/lib/types'
import type { TemplateElementDefinition, TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'
import { resolveSceneComposition } from './scene-composition'

export const MIN_ELEMENT_FRAMES = 1
/** Upper bound for an authored local frame (a Scene is at most 60 s; generous headroom, still bounded). */
export const MAX_ELEMENT_LOCAL_FRAME = 60 * 60

// ── Template capability ───────────────────────────────────────────────────────

/** Elements of a layout that take Scene-local timing, in the Template's element order. */
export function temporalElements(layout: Pick<TemplateLayoutDefinition, 'elements'>): TemplateElementDefinition[] {
  return layout.elements.filter((element) => element.timing !== undefined)
}

export function isTemporalElement(layout: Pick<TemplateLayoutDefinition, 'elements'>, elementId: string): boolean {
  return layout.elements.some((element) => element.id === elementId && element.timing !== undefined)
}

// ── Reading (never rewrites storage) ──────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWholeFrame(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= MAX_ELEMENT_LOCAL_FRAME
}

function readEntry(raw: unknown): VideoSceneElementTiming | null {
  if (!isPlainObject(raw) || !isWholeFrame(raw.start_frame, 0)) return null
  if (raw.duration_frames === undefined) return { start_frame: raw.start_frame }
  return isWholeFrame(raw.duration_frames, MIN_ELEMENT_FRAMES) ? { start_frame: raw.start_frame, duration_frames: raw.duration_frames } : null
}

/**
 * The Scene's authored timing that applies to its CURRENT layout: entries for
 * elements the layout does not declare temporal, and malformed entries, are
 * ignored (full-Scene), exactly like unknown ids in hidden_elements.
 */
export function readSceneElementTiming(scene: Pick<VideoScene, 'element_timing'>, layout: Pick<TemplateLayoutDefinition, 'elements'>): VideoSceneElementTimingMap {
  const raw = scene.element_timing
  if (!isPlainObject(raw)) return {}
  const result: VideoSceneElementTimingMap = {}
  for (const element of temporalElements(layout)) {
    const entry = readEntry(raw[element.id])
    if (entry) result[element.id] = entry
  }
  return result
}

// ── Effective (derived) range ─────────────────────────────────────────────────

export type EffectiveElementRange = {
  /** Scene-local, end exclusive, clipped to the Scene. */
  startFrame: number
  endFrame: number
  /** Ends with the Scene (no authored duration). */
  followsScene: boolean
  /** The authored range reaches past the current Scene end (the tail is not drawn). */
  clipped: boolean
  /** The authored start is at/after the Scene end: the element does not appear in this Scene at all. */
  outside: boolean
}

export function effectiveElementRange(timing: VideoSceneElementTiming | undefined, sceneDurationFrames: number): EffectiveElementRange {
  const start = timing?.start_frame ?? 0
  const followsScene = timing?.duration_frames === undefined
  const authoredEnd = followsScene ? sceneDurationFrames : start + (timing?.duration_frames ?? 0)
  const startFrame = Math.min(start, sceneDurationFrames)
  const endFrame = Math.max(startFrame, Math.min(authoredEnd, sceneDurationFrames))
  return { startFrame, endFrame, followsScene, clipped: !followsScene && authoredEnd > sceneDurationFrames, outside: start >= sceneDurationFrames }
}

/** Whether an element with this effective range is present at a Scene-local frame. */
export function isElementActiveAt(range: Pick<EffectiveElementRange, 'startFrame' | 'endFrame'>, localFrame: number): boolean {
  return localFrame >= range.startFrame && localFrame < range.endFrame
}

// ── Neutral manifest derivation ───────────────────────────────────────────────

/** Neutral per-segment timing: Scene-local frames, already clipped to the segment. */
export type SegmentElementTiming = { element_id: string; start_frame: number; duration_frames: number }

/**
 * What the render contract carries for one Scene segment. Only elements with
 * AUTHORED timing appear (plus their Template companions, which share the
 * range); an element absent from the list is full-Scene, as before. Undefined
 * when nothing is timed, so an untouched Scene yields the exact previous payload.
 */
export function deriveSegmentElementTiming(scene: Pick<VideoScene, 'element_timing'>, layout: Pick<TemplateLayoutDefinition, 'elements'>, sceneDurationFrames: number): SegmentElementTiming[] | undefined {
  const authored = readSceneElementTiming(scene, layout)
  const result: SegmentElementTiming[] = []
  for (const element of temporalElements(layout)) {
    const timing = authored[element.id]
    if (!timing) continue
    const range = effectiveElementRange(timing, sceneDurationFrames)
    for (const id of [element.id, ...(element.timing?.companions ?? [])]) {
      if (!layout.elements.some((candidate) => candidate.id === id) || result.some((entry) => entry.element_id === id)) continue
      result.push({ element_id: id, start_frame: range.startFrame, duration_frames: range.endFrame - range.startFrame })
    }
  }
  return result.length > 0 ? result : undefined
}

// ── Timeline projection (child rows; UI only, never persisted) ───────────────

export type SceneTimingRow = {
  elementId: string
  label: string
  /** Hidden in Camadas: never drawn, whatever its timing. */
  hidden: boolean
  authored: VideoSceneElementTiming | null
  range: EffectiveElementRange
  /** Global frames on the ONE ruler (derived: sceneStart + local). */
  globalStartFrame: number
  globalEndFrame: number
}

/**
 * Child rows of an expanded Scene: its temporal elements in the Template's
 * element order (not paint order), each mapped onto the global ruler.
 */
export function sceneTimingRows(scene: VideoScene, sceneStartFrame: number, sceneDurationFrames: number): SceneTimingRow[] {
  const composition = resolveSceneComposition(scene)
  const authored = readSceneElementTiming(scene, composition.layout)
  return temporalElements(composition.layout).map((element) => {
    const range = effectiveElementRange(authored[element.id], sceneDurationFrames)
    return {
      elementId: element.id,
      label: element.label,
      hidden: composition.hiddenElements.includes(element.id),
      authored: authored[element.id] ?? null,
      range,
      globalStartFrame: sceneStartFrame + range.startFrame,
      globalEndFrame: sceneStartFrame + range.endFrame,
    }
  })
}

export function sceneHasTemporalElements(scene: VideoScene): boolean {
  return temporalElements(resolveSceneComposition(scene).layout).length > 0
}

// ── Edits (pure; touch ONLY `element_timing`) ─────────────────────────────────

function withElementTiming(scene: VideoScene, next: VideoSceneElementTimingMap): VideoScene {
  const { element_timing: _previous, ...rest } = scene
  void _previous
  return Object.keys(next).length > 0 ? { ...rest, element_timing: next } : rest
}

export type ElementTimingPatch = {
  start_frame?: number
  /** A number = fixed duration; null = until the Scene ends. Omitted = unchanged. */
  duration_frames?: number | null
}

/**
 * Authors one element's timing. Values are whole frames, bounded to the Scene
 * as it is NOW (start inside the Scene, a fixed range ending by the Scene end).
 * The default (start 0, until the Scene ends) is stored as no entry at all.
 */
export function setSceneElementTiming(scene: VideoScene, elementId: string, patch: ElementTimingPatch, sceneDurationFrames: number): VideoScene {
  const { layout } = resolveSceneComposition(scene)
  if (!isTemporalElement(layout, elementId) || sceneDurationFrames < 1) return scene
  const current = readSceneElementTiming(scene, layout)
  const previous = current[elementId] ?? { start_frame: 0 }
  const lastStart = Math.max(0, sceneDurationFrames - MIN_ELEMENT_FRAMES)
  const requestedStart = patch.start_frame !== undefined && Number.isFinite(patch.start_frame) ? Math.round(patch.start_frame) : previous.start_frame
  const start = Math.min(Math.max(0, requestedStart), lastStart)
  let duration = patch.duration_frames === undefined ? previous.duration_frames : patch.duration_frames ?? undefined
  if (duration !== undefined) {
    if (!Number.isFinite(duration)) return scene
    duration = Math.min(Math.max(MIN_ELEMENT_FRAMES, Math.round(duration)), sceneDurationFrames - start)
  }
  const next: VideoSceneElementTimingMap = { ...current }
  if (start === 0 && duration === undefined) delete next[elementId]
  else next[elementId] = duration === undefined ? { start_frame: start } : { start_frame: start, duration_frames: duration }
  return withElementTiming(scene, next)
}

/** "Cena inteira": back to the default (the element participates for the whole Scene). */
export function resetSceneElementTiming(scene: VideoScene, elementId: string): VideoScene {
  if (!isPlainObject(scene.element_timing) || !(elementId in scene.element_timing)) return scene
  const next = { ...scene.element_timing }
  delete next[elementId]
  return withElementTiming(scene, next)
}

// ── Write-boundary validation (API) ───────────────────────────────────────────

const ENTRY_KEYS = new Set(['start_frame', 'duration_frames'])
const MAX_TIMED_ELEMENTS = 64

/**
 * Structural check of a persisted `element_timing` (PATCH/POST). Element ids
 * are checked against the layout at read time (unknown = ignored), like
 * hidden_elements, so a layout switch never makes a saved draft invalid.
 */
export function validateSceneElementTimingShape(raw: unknown): { ok: true } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (!isPlainObject(raw)) return { ok: false, message: 'Timing dos elementos inválido.' }
  const ids = Object.keys(raw)
  if (ids.length > MAX_TIMED_ELEMENTS) return { ok: false, message: 'Timing dos elementos grande demais.' }
  for (const id of ids) {
    if (!id.trim() || id.length > 64) return { ok: false, message: 'Elemento com timing inválido.' }
    const entry = raw[id]
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))) return { ok: false, message: `Timing inválido para o elemento ${id}.` }
    if (!isWholeFrame(entry.start_frame, 0)) return { ok: false, message: `Início inválido para o elemento ${id}.` }
    if (entry.duration_frames !== undefined && !isWholeFrame(entry.duration_frames, MIN_ELEMENT_FRAMES)) return { ok: false, message: `Duração inválida para o elemento ${id}.` }
  }
  return { ok: true }
}
