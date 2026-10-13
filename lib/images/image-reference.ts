// Browser-safe reference policy. Model capabilities remain owned by the Gemini registry.
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import type { ImageGenerationWorkingStateV1 } from '@/lib/image-generation/session'

export type ImageReference = ImageGenerationWorkingStateV1['sourceReferences'][number]
export const IMAGE_REFERENCE_UNSUPPORTED = 'Este modelo não envia referências de imagem. Selecione Google Gemini Nano Banana 2.1 ou Lite, ou remova a referência.'

export function imageReferenceUnsupportedModelReason(model: string): string | null {
  return resolveGeminiImageModel(model)?.referenceCapabilities ? null : 'Este modelo não envia referências de imagem. Selecione Google Gemini Nano Banana 2.1 ou Lite para escolher uma referência.'
}

export function imageReferenceModelReason(model: string, references: ImageReference[]): string | null {
  if (!references.length) return null
  const capability = resolveGeminiImageModel(model)?.referenceCapabilities
  if (!capability) return IMAGE_REFERENCE_UNSUPPORTED
  return references.length > capability.maxReferences ? 'Use apenas uma imagem de referência.' : null
}
