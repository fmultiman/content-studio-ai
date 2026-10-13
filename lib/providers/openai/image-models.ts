// Official Images edits/model guide checked 2026-10-13. Only GPT Image 2 is released for reference editing.
// Provider output resolution limits are not input decode limits. V1 retains the three standard output sizes.
export const OPENAI_IMAGE_EDIT_MODEL = 'gpt-image-2' as const
export const OPENAI_IMAGE_EDIT_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
export const OPENAI_IMAGE_EDIT_QUALITIES = ['low', 'medium', 'high'] as const

const EDIT_MODEL = Object.freeze({
  model: OPENAI_IMAGE_EDIT_MODEL,
  sizes: OPENAI_IMAGE_EDIT_SIZES,
  qualities: OPENAI_IMAGE_EDIT_QUALITIES,
  outputFormat: 'png' as const,
  background: 'opaque' as const,
  moderation: 'auto' as const,
  // Not configurable for GPT Image 2; high fidelity is automatic.
  inputFidelity: null,
  referenceCapabilities: Object.freeze({
    maxReferences: 1, providerMaxReferences: 16,
    // Conservative application limit for the multipart/storage path. Not Gemini's inline JSON ceiling.
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
    // Application decoder budget: allow longer edges without increasing total decoded pixels.
    maxDimension: 16384, maxPixels: 8192 ** 2,
    uploadProfile: 'openai-image-reference' as const,
  }),
  providerSizeConstraints: Object.freeze({
    auto: true, custom: true, multiple: 16, maxEdge: 3840,
    maxAspectRatio: 3, minPixels: 655360, maxPixels: 8294400,
  }),
})

export function resolveOpenAIImageEditModel(model: unknown) {
  return model === OPENAI_IMAGE_EDIT_MODEL ? EDIT_MODEL : null
}
