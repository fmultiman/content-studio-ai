/**
 * VIDEO_CANVAS_OUTPUT_FORMAT_V1 — the VideoDraft's output stage (width × height).
 *
 * Authored, document-level spatial truth: every Scene and every root temporal
 * item renders into ONE stage. Source media never defines it (media is fitted
 * inside it), the preview viewport never defines it (zoom/pan stay UI state),
 * and a preset is only a shortcut: dimensions are what persist.
 *
 * Missing (every draft before this mission) = the legacy 1080×1920 stage the
 * product always rendered; old drafts are never rewritten to make it explicit.
 *
 * Two separate questions, two separate answers:
 * - PLATFORM: may a VideoDraft have this stage? (`validateVideoCanvas`, bounds below)
 * - TEMPLATE: can the active Template draw into it? (`videoTemplateCanvasSupport`,
 *   the Template's own declared `canvas_support`, the same rule the resolver enforces
 *   before any preview or render).
 */
import type { VideoScene } from '@/lib/types'
import { resolveTemplate, validateTemplateCanvas } from '@/lib/creative/templates/registry'
import { isFreeComposition } from './free-composition'
import { DEFAULT_TIMELINE_CANVAS, VIDEO_TEMPLATE_FAMILY } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'

export type VideoCanvas = { width: number; height: number }

/** The stage every VideoDraft rendered at before the canvas was authorable. */
export const LEGACY_VIDEO_CANVAS: VideoCanvas = { width: DEFAULT_TIMELINE_CANVAS.width, height: DEFAULT_TIMELINE_CANVAS.height }

/**
 * Platform bounds for a custom stage.
 * - even: H.264 output is yuv420p (4:2:0 chroma), which needs even width and height;
 * - 360 min: below that the Template's 1080-reference typography becomes unreadable;
 * - 1920 max per side: the largest preset side. Caps a frame at 1920×1920 ≈ 3.7 MP,
 *   ≤ 1.8× the proven 1080×1920 production footprint, so VPS render time/memory stays
 *   within a small multiple of what has been measured.
 */
export const VIDEO_CANVAS_LIMITS = { minSide: 360, maxSide: 1920 } as const

export type VideoCanvasPreset = { id: string; label: string; ratio: string } & VideoCanvas

export const VIDEO_CANVAS_PRESETS: readonly VideoCanvasPreset[] = [
  { id: 'vertical', label: 'Vertical', ratio: '9:16', width: 1080, height: 1920 },
  { id: 'portrait', label: 'Feed / Retrato', ratio: '4:5', width: 1080, height: 1350 },
  { id: 'square', label: 'Quadrado', ratio: '1:1', width: 1080, height: 1080 },
  { id: 'horizontal', label: 'Horizontal', ratio: '16:9', width: 1920, height: 1080 },
]

export type VideoCanvasValidation = { ok: true; canvas: VideoCanvas } | { ok: false; message: string }

export function validateVideoCanvas(raw: unknown): VideoCanvasValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'O formato precisa de largura e altura.' }
  const keys = Object.keys(raw)
  if (keys.some((key) => key !== 'width' && key !== 'height')) return { ok: false, message: 'O formato aceita só largura e altura.' }
  const { width, height } = raw as Record<string, unknown>
  const { minSide, maxSide } = VIDEO_CANVAS_LIMITS
  for (const [label, value] of [['Largura', width], ['Altura', height]] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false, message: `${label} precisa ser um número inteiro de pixels.` }
    if (value < minSide || value > maxSide) return { ok: false, message: `${label} precisa ficar entre ${minSide} e ${maxSide} px.` }
    if (value % 2 !== 0) return { ok: false, message: `${label} precisa ser par (exigência do vídeo H.264).` }
  }
  return { ok: true, canvas: { width: width as number, height: height as number } }
}

/** The AUTHORED stage, or null when the draft never set one (legacy). Invalid stored values read as null. */
export function readVideoCanvas(raw: unknown): VideoCanvas | null {
  if (raw === null || raw === undefined) return null
  const result = validateVideoCanvas(raw)
  return result.ok ? result.canvas : null
}

/** The stage that is actually drawn: authored, else the legacy 1080×1920. */
export function effectiveVideoCanvas(raw: unknown): VideoCanvas {
  return readVideoCanvas(raw) ?? LEGACY_VIDEO_CANVAS
}

export function sameVideoCanvas(a: VideoCanvas | null, b: VideoCanvas | null): boolean {
  if (!a || !b) return a === b
  return a.width === b.width && a.height === b.height
}

/** Preset whose dimensions match exactly; null = Personalizado. Derived, never stored. */
export function matchVideoCanvasPreset(canvas: VideoCanvas): VideoCanvasPreset | null {
  return VIDEO_CANVAS_PRESETS.find((preset) => preset.width === canvas.width && preset.height === canvas.height) ?? null
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** "9:16", "4:5", "1:1", "16:9" or the reduced ratio of a custom stage. */
export function videoCanvasRatio(canvas: VideoCanvas): string {
  const preset = matchVideoCanvasPreset(canvas)
  if (preset) return preset.ratio
  const divisor = gcd(canvas.width, canvas.height)
  return `${canvas.width / divisor}:${canvas.height / divisor}`
}

export type VideoTemplateCanvasSupport = {
  supported: boolean
  templateLabel: string
  supportedSizes: VideoCanvas[]
}

/**
 * Whether the VideoDraft's Template family declares this stage. Every Video
 * Scene today renders through that one family, so it is the gate. It is the
 * Template's `canvas_support` — the same declaration the resolver enforces for
 * the Live Player and the render enqueue — not a second rule.
 */
export type VideoDraftCanvasSupport = VideoTemplateCanvasSupport & {
  /** How many Scenes are Template-backed (the only ones the Template rule applies to). */
  templateBackedScenes: number
}

/**
 * VIDEO_FREE_SCENE_COMPOSITION_V1 — the draft-level rule. A free Scene has no
 * Template, so it imposes only the platform bounds; the stage is drawable only
 * if EVERY Template-backed Scene's family declares it. One free Scene does not
 * unlock 16:9 for its Template neighbours; a free-only draft is not gated by a
 * Template at all.
 */
export function videoDraftCanvasSupport(scenes: readonly Pick<VideoScene, 'composition'>[], canvas: VideoCanvas): VideoDraftCanvasSupport {
  const templateBackedScenes = scenes.filter((scene) => !isFreeComposition(scene.composition)).length
  const template = videoTemplateCanvasSupport(canvas)
  return templateBackedScenes > 0
    ? { ...template, templateBackedScenes }
    : { ...template, supported: validateVideoCanvas(canvas).ok, templateBackedScenes }
}

export function videoTemplateCanvasSupport(canvas: VideoCanvas): VideoTemplateCanvasSupport {
  const template = resolveTemplate({ ...VIDEO_TEMPLATE_FAMILY, variant: 'cover' })
  if (!template.valid) return { supported: false, templateLabel: VIDEO_TEMPLATE_FAMILY.id, supportedSizes: [] }
  const support = template.value.descriptor.canvas_support
  const supportedSizes = support.strategy === 'declared_sizes'
    ? support.sizes.map(({ width, height }) => ({ width, height }))
    : support.strategy === 'fixed' ? [{ width: support.size.width, height: support.size.height }] : []
  return {
    supported: validateTemplateCanvas(template.value, { ...canvas, unit: 'px' }).valid,
    templateLabel: template.value.descriptor.label,
    supportedSizes,
  }
}
