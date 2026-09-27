/**
 * Creative Editor Video Foundation V1 — Scene authoring over the existing
 * VideoDraft / VideoScene[] authority.
 *
 * The Video editor persists through the SAME `/api/video-drafts` PATCH the
 * retired /videos workspace used: `{ id, name, projectId, productionId, scenes }`. Since
 * VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1 this editor is its only product writer.
 * Nothing temporal or visual beyond VideoScene's own fields enters that body —
 * no start frames, no TimelineManifest, no zoom/scroll/selection/playhead —
 * except the authored independent layer (`timeline`, VIDEO_TIMELINE_GATE_B),
 * whose items carry their own absolute frames by definition.
 */
import type { VideoDraft, VideoScene } from '@/lib/types'
import { movementToMotion } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { renumberScenes } from './scene-timeline'
import { persistedVideoTimeline, type VideoTimeline } from './temporal-items'
import type { VideoCanvas } from './video-canvas'

/** Same defaults as the legacy /videos addScene. */
export const NEW_SCENE_DURATION_SECONDS = 3
export const MAX_VIDEO_SCENES = 30

export function createVideoScene(scenes: readonly VideoScene[], id: string = crypto.randomUUID()): VideoScene {
  return {
    id,
    order: scenes.length + 1,
    description: '',
    prompt: null,
    image_url: null,
    library_file_id: null,
    duration: NEW_SCENE_DURATION_SECONDS,
    movement: 'static',
  }
}

/** Inserts a new Scene right after `afterIndex` (end of sequence when omitted). */
export function addVideoScene(scenes: readonly VideoScene[], afterIndex?: number, id?: string): { scenes: VideoScene[]; index: number } {
  return insertVideoScene(scenes, createVideoScene(scenes, id), afterIndex)
}

/** Inserts an already-built Scene (Template-backed or free) after `afterIndex`; `order` is renumbered. */
export function insertVideoScene(scenes: readonly VideoScene[], scene: VideoScene, afterIndex?: number): { scenes: VideoScene[]; index: number } {
  const index = afterIndex === undefined ? scenes.length : Math.min(scenes.length, Math.max(0, afterIndex + 1))
  const next = [...scenes]
  next.splice(index, 0, scene)
  return { scenes: renumberScenes(next), index }
}

export function removeVideoScene(scenes: readonly VideoScene[], sceneId: string): VideoScene[] {
  return renumberScenes(scenes.filter((scene) => scene.id !== sceneId))
}

export function updateVideoScene(scenes: readonly VideoScene[], sceneId: string, patch: Partial<Omit<VideoScene, 'id' | 'order'>>): VideoScene[] {
  return scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
}

/**
 * Scenes as loaded. ARRAY order is the sequence the render adapter uses
 * (adaptVideoDraftToTimelineManifest iterates `draft.scenes` as stored), so it
 * is kept as-is; only the 1-based `order` field is made consistent with it.
 */
export function normalizeLoadedScenes(scenes: readonly VideoScene[] | null | undefined): VideoScene[] {
  return renumberScenes(Array.isArray(scenes) ? scenes : [])
}

/**
 * The exact authored snapshot used for dirty tracking and "Voltar ao salvo".
 * Gate B: the independent temporal layer is part of it only when it has items,
 * so a draft without one keeps the exact pre-Gate-B snapshot. The output stage
 * (VIDEO_CANVAS_OUTPUT_FORMAT_V1) likewise only when authored.
 */
export function persistedVideoSnapshot(name: string, scenes: readonly VideoScene[], timeline?: VideoTimeline | null, canvas?: VideoCanvas | null): string {
  const persisted = timeline ? persistedVideoTimeline(timeline) : null
  return JSON.stringify({ name, scenes, ...(persisted ? { timeline: persisted } : {}), ...(canvas ? { canvas } : {}) })
}

export type VideoDraftSaveBody = {
  id: string
  name: string
  projectId: string | null
  productionId: string | null
  scenes: VideoScene[]
  /** Gate B: authored independent temporal layer (null = none). Sent only by editors that own it. */
  timeline?: VideoTimeline | null
  /** Authored output stage. Absent = keep the stored value (legacy drafts are never rewritten). */
  canvas?: VideoCanvas
}

/** PATCH /api/video-drafts body — identical contract to the legacy workspace save. */
export function buildVideoDraftSaveBody(
  draft: Pick<VideoDraft, 'id' | 'project_id' | 'production_id'>,
  name: string,
  scenes: readonly VideoScene[],
  timeline?: VideoTimeline,
  canvas?: VideoCanvas | null,
): VideoDraftSaveBody {
  return {
    id: draft.id, name, projectId: draft.project_id, productionId: draft.production_id, scenes: [...scenes],
    ...(timeline ? { timeline: persistedVideoTimeline(timeline) } : {}),
    ...(canvas ? { canvas: { width: canvas.width, height: canvas.height } } : {}),
  }
}

/**
 * VIDEO_MOTION_CAPABILITY_TRUTH_V1 — every movement value this product has
 * ever authored or displayed, for TRUTHFUL LEGACY DISPLAY only (see
 * `movementLabel`): e.g. a Scene Strip card summarizing an already-authored
 * Scene's movement, including a value no longer offered to new Scenes. This
 * is NOT the list of choices offered for authoring — see `motionOptions`.
 */
const MOVEMENT_LABELS: [string, string][] = [
  ['static', 'Estático'],
  ['zoom_in', 'Zoom In (aproximação lenta)'],
  ['fade', 'Fade (entrada suave)'],
  ['pan_left', 'Pan Esquerda'],
  ['pan_right', 'Pan Direita'],
  ['tilt_up', 'Tilt Cima'],
  ['tilt_down', 'Tilt Baixo'],
  ['zoom_out', 'Zoom Out'],
  ['dolly', 'Dolly Forward'],
]

/** Human label for ANY movement value ever authored, including a legacy one no longer offered. */
export function movementLabel(movement: string | null): string {
  const value = movement || 'static'
  return MOVEMENT_LABELS.find(([candidate]) => candidate === value)?.[1] ?? value
}

export type MotionOption = { value: string; label: string }

/**
 * Scene Motion values EVERY Layout draws with a visible effect, identically:
 * DocumentaryCard.tsx fades the whole card in (root opacity) plus each
 * variant's own text/content elements (fixedText opacity + translateY) for
 * `motion.preset === 'fade'`, unconditionally — never gated by `variant`. No
 * declaration needed per Layout for these two.
 */
const UNIVERSAL_SCENE_MOTION: readonly string[] = ['static', 'fade']

/**
 * Scene Motion values a SPECIFIC Layout draws with an ADDITIONAL visible
 * effect, beyond the two universal ones. Code-backed, narrow, Layout-scoped:
 * only Cover's hero slow-zoom (`zoom_in` → `slow_push`, `CoverVariant.tsx`
 * `heroScale`) exists today. This is SCENE Motion — the whole composition's
 * behavior — never per-Element (a separate, future, Element-scoped concept:
 * VIDEO_ELEMENT_MOTION_PRESETS_V1). Keep this table narrow; do not turn it
 * into a generic capability engine.
 */
const LAYOUT_SCENE_MOTION: Readonly<Record<string, readonly string[]>> = {
  cover: ['zoom_in'],
}

/**
 * The ONLY Scene Motion values offered for authoring on `layoutId`: the
 * Layout's declared capability (universal + `LAYOUT_SCENE_MOTION`),
 * cross-checked against `movementToMotion` so this list can never silently
 * drift from what the renderer actually draws — a value with no real preset
 * mapping is never returned here, even if mistakenly declared above. A value
 * NOT in this list is a legacy state: still safe to load, still displayed
 * truthfully via `movementLabel`, never silently rewritten, just not offered
 * again (see the Motion tab's legacy notice in the Video editor page).
 */
export function motionOptions(layoutId: string = 'cover'): MotionOption[] {
  const values = [...UNIVERSAL_SCENE_MOTION, ...(LAYOUT_SCENE_MOTION[layoutId] ?? [])]
  return values
    .filter((value) => movementToMotion(value).diagnostic === null)
    .map((value) => ({ value, label: movementLabel(value) }))
}
