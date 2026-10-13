// Browser-safe reference policy. Provider model registries own the capabilities.
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import { resolveOpenAIImageEditModel } from '@/lib/providers/openai/image-models'
import type { ImageGenerationWorkingStateV1 } from '@/lib/image-generation/session'

export type ImageReference = ImageGenerationWorkingStateV1['sourceReferences'][number]
export const IMAGE_REFERENCE_UNSUPPORTED = 'Este modelo não envia referências de imagem. Selecione GPT Image 2 ou Google Gemini Nano Banana 2.1/Lite, ou remova a referência.'

export type ImageReferenceCapabilities = {
  maxReferences: number; maxBytes: number; mimeTypes: readonly string[];
  maxDimension: number; maxPixels?: number;
  uploadProfile: 'image-reference' | 'openai-image-reference';
}

export function getImageReferenceCapabilities(model: unknown): ImageReferenceCapabilities | null {
  const openai = resolveOpenAIImageEditModel(model)
  if (openai) return openai.referenceCapabilities
  const gemini = resolveGeminiImageModel(model)
  return gemini ? { ...gemini.referenceCapabilities, uploadProfile: 'image-reference' } : null
}

export function imageReferenceUnsupportedModelReason(model: string): string | null {
  return getImageReferenceCapabilities(model) ? null : IMAGE_REFERENCE_UNSUPPORTED
}

export function imageReferenceModelReason(model: string, references: ImageReference[]): string | null {
  if (!references.length) return null
  const capability = getImageReferenceCapabilities(model)
  if (!capability) return IMAGE_REFERENCE_UNSUPPORTED
  return references.length > capability.maxReferences ? 'Use apenas uma imagem de referência.' : null
}
