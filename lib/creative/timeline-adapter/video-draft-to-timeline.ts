/**
 * Phase 2G-A — VideoDraft.scenes -> TimelineManifest adapter.
 *
 * Pure domain -> neutral-schema conversion. No Supabase, S3, Remotion, React,
 * filesystem, network, or API-route code belongs here (see
 * lib/creative/__tests__/video-draft-to-timeline.test.ts boundary checks).
 *
 * Real asset resolution is explicitly deferred (Phase 2G0 finding): every
 * scene is given the same proven fixture hero asset regardless of its own
 * image_url. VideoScene.description/prompt/image_url are never conflated
 * into manifest content -- they have no legitimate template-content
 * equivalent today, so they are left out rather than forced in.
 *
 * VIDEO_SCENE_COMPOSITION_PARITY_V1: layout, appearance, content and the
 * element stack come from the Scene's authored `composition`, resolved by
 * `resolveSceneComposition` (absent = Cover · Dark · "Cena N" · default stack,
 * the composition every Scene rendered with before).
 */
import type { AssetRef, IdentitySnapshotRef, MotionSpec } from '@/lib/schemas/creative/primitives'
import type { TemplateSegmentLayering, TemplateSegmentSchema, TimelineManifest, TimelineSpecification } from '@/lib/schemas/creative/timeline'
import type { VideoDraft, VideoScene } from '@/lib/types'
import { resolveSceneComposition } from '@/lib/creative/video-editor/scene-composition'

type TemplateSegment = typeof TemplateSegmentSchema['_output']

/** Matches every existing timeline fixture and the Wave 7/8 proof (30fps) -- not a new default. */
export const DEFAULT_TIMELINE_FPS = 30

/** editorial.documentary-card's declared canvas_support second size (Wave 7/8 fixtures use it for video). */
export const DEFAULT_TIMELINE_CANVAS = { width: 1080, height: 1920 } as const

/** Proven-resolvable fixture hero (lib/creative/assets/resolve-asset.ts). Real asset wiring is a later phase. */
export const DEFAULT_HERO_ASSET_REF: AssetRef = {
  type: 'fixture',
  ref: 'fixture:asset:documentary-card:hero-archival-01',
  fit: 'cover',
}

/** The renderer identity of the VideoDraft's Template family (variant/appearance come from each Scene). */
const DOCUMENTARY_CARD_TEMPLATE = { id: 'editorial.documentary-card', version: '0.1.0', scope: 'system' } as const

const DEFAULT_RENDER_INTENT = { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' } as const

export type AdapterDiagnosticKind = 'motion_unsupported' | 'field_unused' | 'content_defaulted' | 'asset_unresolved'

export type AdapterDiagnostic = {
  kind: AdapterDiagnosticKind
  code: string
  message: string
  path: string
}

export type AdaptVideoDraftInput = {
  draft: Pick<VideoDraft, 'id' | 'project_id' | 'production_id' | 'scenes'>
  /** Caller-supplied identity (real Project Identity snapshot or a fixture ref) -- never fetched here. */
  identity: IdentitySnapshotRef
  /** Explicit, deterministic canvas/fps. Defaults to the proven 1080x1920 @ 30fps used by every existing timeline fixture. */
  canvas?: { width: number; height: number; fps?: number }
  /** Fixture/real hero asset used for any scene without an explicit binding in sceneAssets. */
  heroAssetRef?: AssetRef
  /**
   * Explicit, caller-supplied asset binding per scene (keyed by VideoScene.id).
   * This is the seam Phase 2G-B uses to bind a real `library_file` AssetRef to
   * a specific scene -- VideoScene.image_url itself is never interpreted as
   * an asset contract (Phase 2G-A decision, preserved here).
   */
  sceneAssets?: Record<string, AssetRef>
}

export type AdaptVideoDraftResult = {
  manifest: TimelineManifest
  diagnostics: AdapterDiagnostic[]
}

/**
 * VideoScene.movement -> MotionSpec.
 *
 * Only movements with a real, template-declared preset equivalent
 * (editorial.documentary-card capabilities.motion_presets =
 * ['none', 'fade', 'slow_push', 'slow_pan']) are mapped. Everything else
 * falls back to 'none' with an explicit diagnostic -- no invented presets.
 */
export function movementToMotion(movement: string | null): { motion: MotionSpec; diagnostic: AdapterDiagnostic | null } {
  switch (movement) {
    case 'static':
      return { motion: { preset: 'none' }, diagnostic: null }
    case 'zoom_in':
      return { motion: { preset: 'slow_push' }, diagnostic: null }
    case 'pan_left':
      return { motion: { preset: 'slow_pan', direction: 'left' }, diagnostic: null }
    case 'pan_right':
      return { motion: { preset: 'slow_pan', direction: 'right' }, diagnostic: null }
    case 'tilt_up':
      return { motion: { preset: 'slow_pan', direction: 'up' }, diagnostic: null }
    case 'tilt_down':
      return { motion: { preset: 'slow_pan', direction: 'down' }, diagnostic: null }
    default:
      return {
        motion: { preset: 'none' },
        diagnostic: {
          kind: 'motion_unsupported',
          code: 'movement_no_preset_equivalent',
          message: `VideoScene.movement "${movement ?? 'null'}" has no equivalent editorial.documentary-card motion preset; defaulted to "none".`,
          path: 'segment.payload.motion',
        },
      }
  }
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps))
}

/**
 * Converts one VideoScene into a template segment placed at startFrame.
 * Kept scene-at-a-time (not indexed as segments[0]) so a future multi-scene
 * caller can loop this without rewriting the mapping -- multi-scene
 * composition itself (transitions, track layout beyond one video track) is
 * out of scope for this phase.
 */
export function sceneToSegment(
  scene: VideoScene,
  startFrame: number,
  fps: number,
  trackId: string,
  totalScenes: number,
  heroAssetRef: AssetRef,
): { segment: TemplateSegment; diagnostics: AdapterDiagnostic[] } {
  const diagnostics: AdapterDiagnostic[] = []
  const durationFrames = secondsToFrames(scene.duration, fps)
  const { motion, diagnostic: motionDiagnostic } = movementToMotion(scene.movement)
  if (motionDiagnostic) diagnostics.push(motionDiagnostic)

  if (scene.image_url) {
    diagnostics.push({
      kind: 'field_unused',
      code: 'scene_image_url_not_used',
      message: `Scene "${scene.id}" has inline image data; real asset resolution is deferred to a later phase. A fixture hero asset was used instead.`,
      path: 'segment.payload.assets.hero',
    })
  }
  for (const [field, value] of [['description', scene.description], ['prompt', scene.prompt]] as const) {
    if (value && value.trim()) {
      diagnostics.push({
        kind: 'field_unused',
        code: `scene_${field}_not_used`,
        message: `Scene "${scene.id}".${field} was not mapped into manifest content (no legitimate template-content equivalent) to avoid semantic conflation.`,
        path: `segment.payload.content`,
      })
    }
  }
  // VIDEO_SCENE_COMPOSITION_PARITY_V1: the Scene's authored composition (or
  // the Template default it always rendered with) — the SAME resolution the
  // Live Authoring Player uses, since both go through this adapter.
  const composition = resolveSceneComposition(scene)
  if (!composition.authored.content) {
    diagnostics.push({
      kind: 'content_defaulted',
      code: 'content_title_placeholder',
      message: `Scene "${scene.id}" has no authored content; the positional placeholder title was used.`,
      path: 'segment.payload.content.title',
    })
  }
  for (const axis of composition.fallbacks) {
    diagnostics.push({
      kind: 'content_defaulted',
      code: `scene_${axis}_unsupported`,
      message: `Scene "${scene.id}" has an authored ${axis} that is not supported in video; the Template default was used.`,
      path: axis === 'layout' ? 'segment.payload.template.variant' : 'segment.payload.template.appearance',
    })
  }

  const layering: TemplateSegmentLayering = {
    ...(composition.elementOrderIsDefault ? {} : { element_order: composition.elementOrder }),
    ...(composition.hiddenElements.length > 0 ? { hidden_elements: composition.hiddenElements } : {}),
  }

  const segment: TemplateSegment = {
    id: `scene:${scene.id}`,
    track_id: trackId,
    start_frame: startFrame,
    duration_frames: durationFrames,
    kind: 'template',
    payload: {
      template: { ...DOCUMENTARY_CARD_TEMPLATE, variant: composition.layoutId, appearance: composition.appearance },
      content: composition.content,
      // Only layouts that draw the content image take the Scene's hero; the
      // others' asset contracts do not accept one (the binding is kept on the Scene).
      assets: composition.usesHero ? { hero: heroAssetRef } : {},
      sequence: { index: scene.order, total: totalScenes },
      motion,
      ...(Object.keys(layering).length > 0 ? { layering } : {}),
    },
  }

  return { segment, diagnostics }
}

export function adaptVideoDraftToTimelineManifest(input: AdaptVideoDraftInput): AdaptVideoDraftResult {
  const { draft, identity } = input
  if (!draft.project_id || !draft.production_id) {
    throw new Error('adaptVideoDraftToTimelineManifest requires a VideoDraft with both project_id and production_id set.')
  }
  if (draft.scenes.length === 0) {
    throw new Error('adaptVideoDraftToTimelineManifest requires at least one scene.')
  }

  const fps = input.canvas?.fps ?? DEFAULT_TIMELINE_FPS
  const width = input.canvas?.width ?? DEFAULT_TIMELINE_CANVAS.width
  const height = input.canvas?.height ?? DEFAULT_TIMELINE_CANVAS.height
  const defaultHeroAssetRef = input.heroAssetRef ?? DEFAULT_HERO_ASSET_REF
  const trackId = 'video-main'

  const diagnostics: AdapterDiagnostic[] = []
  const segments: TemplateSegment[] = []
  let cursor = 0
  for (const scene of draft.scenes) {
    const heroAssetRef = input.sceneAssets?.[scene.id] ?? defaultHeroAssetRef
    const { segment, diagnostics: sceneDiagnostics } = sceneToSegment(scene, cursor, fps, trackId, draft.scenes.length, heroAssetRef)
    segments.push(segment)
    diagnostics.push(...sceneDiagnostics)
    cursor += segment.duration_frames
  }

  const specification: TimelineSpecification = { width, height, fps, duration_frames: cursor }

  const manifest: TimelineManifest = {
    schema_version: 'timeline.v0',
    manifest_id: `video-draft:${draft.id}`,
    context: {
      project_ref: draft.project_id,
      production_ref: draft.production_id,
      video_work_ref: draft.id,
    },
    specification,
    identity,
    tracks: [{ id: trackId, kind: 'video', order: 0 }],
    segments,
    assets: {},
    render_intent: DEFAULT_RENDER_INTENT,
  }

  return { manifest, diagnostics }
}
