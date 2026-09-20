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
import type { MaterialName } from './primitives'

export type DocumentaryCardVariant = 'cover' | 'info'
export type DocumentaryCardMode = 'still' | 'video'
export type DocumentaryCardContent = DocumentaryCardCoverContent | DocumentaryCardInfoContent

export type DocumentaryCardProps = {
  variant: DocumentaryCardVariant
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
}

export type DocumentaryCardVisualContext = DocumentaryCardProps & {
  progress: number
  contentOpacity: number
  contentTranslateY: number
}
