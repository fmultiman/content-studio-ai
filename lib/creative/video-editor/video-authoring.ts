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
  const scene = createVideoScene(scenes, id)
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
 * What a preset visibly does in a given layout TODAY (VIDEO_SCENE_COMPOSITION_PARITY_V1
 * renderer audit): DocumentaryCard draws `slow_push` only as the Cover hero's
 * slow zoom, and `fade` on the whole Scene; `slow_pan` is declared by the
 * Template but no layout draws it. Motion applies to the Scene composition
 * as one unit — never per element, never keyframed.
 */
export type MotionEffect = 'none' | 'primary-media' | 'scene' | 'not-drawn'

export function motionEffect(preset: string, layoutId: string): MotionEffect {
  if (preset === 'fade') return 'scene'
  if (preset === 'slow_push') return layoutId === 'cover' ? 'primary-media' : 'not-drawn'
  if (preset === 'slow_pan') return 'not-drawn'
  return 'none'
}

export type MotionOption = { value: string; label: string; preset: string; supported: boolean; effect: MotionEffect }

const MOVEMENT_LABELS: [string, string][] = [
  ['static', 'Estático'],
  ['zoom_in', 'Zoom In (aproximação lenta)'],
  ['pan_left', 'Pan Esquerda'],
  ['pan_right', 'Pan Direita'],
  ['tilt_up', 'Tilt Cima'],
  ['tilt_down', 'Tilt Baixo'],
  ['zoom_out', 'Zoom Out'],
  ['dolly', 'Dolly Forward'],
]

/**
 * Motion = the existing VideoScene.movement vocabulary, annotated with the
 * semantic preset the adapter actually renders. Movements without a Template
 * preset stay selectable for legacy compatibility but are labelled honestly.
 */
export function motionOptions(layoutId: string = 'cover'): MotionOption[] {
  return MOVEMENT_LABELS.map(([value, label]) => {
    const { motion, diagnostic } = movementToMotion(value)
    return { value, label, preset: motion.preset, supported: diagnostic === null, effect: motionEffect(motion.preset, layoutId) }
  })
}

export const PRESET_LABELS: Record<string, string> = {
  none: 'sem movimento',
  slow_push: 'aproximação lenta',
  slow_pan: 'panorâmica lenta',
  fade: 'fade',
}
