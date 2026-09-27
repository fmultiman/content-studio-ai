/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — Static FREE composition.
 *
 * The Creative Editor has exactly two composition modes: FREE and TEMPLATE.
 * New authoring starts FREE (an empty free composition = a blank canvas); a
 * Template is an explicit opt-in. There is no third "unconfigured" state.
 *
 * Static keeps its domain owner (the ChannelPiece-owned authoring row) and its
 * collection-level mode: a carousel is either all-free or all-Template. A free
 * slide carries the SAME composition value a Video free Scene carries —
 * `{ kind: 'free', elements }` — so the spatial semantics (stable ids, stage-
 * fraction boxes, paint order, visibility, Identity-role styling, LibraryFile
 * images) and their helpers/validation are shared. Nothing temporal exists here.
 */
import type { FreeSceneComposition, FreeSceneElement } from '@/lib/types'
import type { StaticFreeRenderManifest } from '@/lib/schemas/creative/static-render'
import type { CanvasSpec } from '@/lib/schemas/creative/primitives'
import { deriveFreeSegment, freeElements, isFreeComposition } from '@/lib/creative/video-editor/free-composition'

export type StaticCompositionMode = 'free' | 'template'

/** One free unit of a Static composition (a single post, or one slide of a free carousel). */
export type FreeStaticSlide = { id: string; order: number; composition: FreeSceneComposition }

export function createFreeStaticSlide(id: string, order: number): FreeStaticSlide {
  return { id, order, composition: { kind: 'free', elements: [] } }
}

export function isFreeStaticSlide(slide: unknown): slide is FreeStaticSlide {
  return typeof slide === 'object' && slide !== null && isFreeComposition((slide as { composition?: unknown }).composition)
}

/** Every Library image the free slides reference. */
export function freeStaticImageIds(slides: readonly FreeStaticSlide[]): string[] {
  const ids = new Set<string>()
  for (const slide of slides) for (const element of freeElements(slide)) if (element.kind === 'image') ids.add(element.library_file_id)
  return [...ids]
}

/** A composition switch is destructive when it would drop authored work (any element, or more than one unit). */
export function freeCompositionHasContent(slides: readonly FreeStaticSlide[]): boolean {
  return slides.length > 1 || slides.some((slide) => freeElements(slide).length > 0)
}

/** The authored elements, normalized for the render request (ids, boxes, roles, LibraryFile ids only). */
export function freeElementsForRender(slide: FreeStaticSlide): FreeSceneElement[] {
  return freeElements(slide).map((element) => ({ ...element, box: { ...element.box } }))
}

/**
 * The neutral free still manifest: no TemplateRef, no layout content. Hidden
 * elements and empty texts are not drawn (same rule as the Video free segment);
 * images become manifest-level `library_file` refs. Server-authoritative fields
 * (canvas, source, context, identity) come from the caller, never the browser.
 */
export function buildStaticFreeRenderManifest(input: {
  composition: FreeSceneComposition
  canvas: CanvasSpec
  channelPieceId: string
  projectId: string
  productionId?: string | null
  identitySnapshotRef: string
  slideId?: string | null
}): StaticFreeRenderManifest {
  const { payload, assets } = deriveFreeSegment(input.composition)
  return {
    schema_version: 'static-render.v0',
    manifest_id: `static-free:${input.channelPieceId}:${input.slideId ?? 'slide'}`,
    source: { type: 'channel_piece', ref: input.channelPieceId },
    context: { project_ref: input.projectId, ...(input.productionId ? { production_ref: input.productionId } : {}) },
    composition: { kind: 'free', elements: payload.elements },
    canvas: input.canvas,
    identity: { snapshot_ref: input.identitySnapshotRef, token_profile: 'default' },
    assets,
    output: { format: 'png' },
  }
}
