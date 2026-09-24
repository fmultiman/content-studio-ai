import type {
  CanvasSpec,
  MotionSpec,
  SequenceContext,
  VisualTokensSnapshot,
} from '@/lib/schemas/creative/primitives'
import type {
  DocumentaryCardCoverContent,
  DocumentaryCardInfoContent,
} from '@/lib/schemas/creative/documentary-card'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { DocumentaryCardPreviewTuning } from '@/lib/creative/authoring/types'
import type { PrimitiveTransforms, PrimitiveTransformSlot } from '@/lib/creative/primitives/transforms'
import type { ElementStack } from '@/lib/creative/templates/element-stack'
import type { MaterialName } from './primitives'

export type { DocumentaryCardPreviewTuning }

export type DocumentaryCardVariant = 'cover' | 'info'
export type DocumentaryCardMode = 'still' | 'video'
export type DocumentaryCardContent = DocumentaryCardCoverContent | DocumentaryCardInfoContent
/**
 * Rendering-style axis, independent of structural variant (Slice 1 — Portal
 * Carousel V1). Absent means the legacy default: dark for cover, light for
 * info — preserving every render made before this axis existed.
 */
export type DocumentaryCardAppearance = 'light' | 'dark'

export type DocumentaryCardProps = {
  variant: DocumentaryCardVariant
  appearance?: DocumentaryCardAppearance
  content: DocumentaryCardContent
  assets: Record<string, ResolvedAsset>
  tokens: VisualTokensSnapshot
  canvas: CanvasSpec
  mode: DocumentaryCardMode
  motion?: MotionSpec
  sequence?: SequenceContext
  frame?: number
  durationInFrames?: number
  materialBaseUrl?: string
  materialUrls?: Partial<Record<MaterialName, string>>
  materialAssets?: Partial<Record<MaterialName, ResolvedAsset>>
  /** Selected project-scoped primitive materials. Absent means explicit fixture control fallback. */
  primitiveMaterials?: Partial<Record<'paper' | 'tape', ResolvedAsset>>
  primitiveTransforms?: Partial<Record<PrimitiveTransformSlot, PrimitiveTransforms>>
  /**
   * Creative Editor Template Foundation V1 — the authoring Template and this
   * slide's element stack (paint order, back -> front). Both optional:
   * absent = default template / the layout's default stack. Normalized
   * inside DocumentaryCard by lib/creative/templates/element-stack.ts, the
   * same helper for the Editor preview and the worker's renderStill.
   */
  templateId?: string
  elementOrder?: readonly string[]
  /**
   * Wave 6 authoring-only: runtime visual tuning applied on top of the default
   * artifact plan. NEVER serialised into a StaticRenderManifest.
   * When absent, the component renders exactly as the Wave 5 still would.
   */
  previewTuning?: DocumentaryCardPreviewTuning
}

export type DocumentaryCardVisualContext = DocumentaryCardProps & {
  progress: number
  contentOpacity: number
  contentTranslateY: number
  /** appearance with the legacy per-variant default already applied — never undefined. */
  resolvedAppearance: DocumentaryCardAppearance
  /** Normalized element stack for this variant (never undefined). */
  stack: ElementStack
}
