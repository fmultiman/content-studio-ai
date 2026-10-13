import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { getImageReferenceCapabilities, imageReferenceUnsupportedModelReason } from '../image-reference'
import { resolveOpenAIImageEditModel } from '@/lib/providers/openai/image-models'
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import { validateGeminiReferenceBytes, validateImageReferenceBytes } from '@/lib/image-generation/reference-media'

describe('per-model image reference capability policy', () => {
  it.each(['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'nanobanana-v1', 'nanobanana-v2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-sunburst'])('keeps %s reference-disabled', (model) => {
    expect(getImageReferenceCapabilities(model)).toBeNull()
    expect(imageReferenceUnsupportedModelReason(model)).toMatch(/não envia referências/)
  })
  it('enables only the approved OpenAI alias with its distinct multipart and decoder budget', () => {
    expect(getImageReferenceCapabilities('gpt-image-2')).toMatchObject({ maxReferences: 1, maxBytes: 20 * 1024 * 1024,
      maxDimension: 16384, maxPixels: 67108864, uploadProfile: 'openai-image-reference' })
    expect(resolveOpenAIImageEditModel('gpt-image-2')?.sizes).toEqual(['1024x1024', '1536x1024', '1024x1536'])
    expect(resolveOpenAIImageEditModel('gpt-image-2')?.inputFidelity).toBeNull()
  })
  it.each(['gemini-nb-2.1', 'gemini-nb-lite'])('preserves %s inline and input limits', (model) => {
    expect(getImageReferenceCapabilities(model)).toMatchObject({ maxBytes: 10 * 1024 * 1024, maxDimension: 8192, uploadProfile: 'image-reference' })
    expect(resolveGeminiImageModel(model)?.referenceCapabilities.maxRequestBytes).toBe(20_000_000)
  })
  it('allows a longer OpenAI input edge while retaining the Gemini wrapper rejection', async () => {
    const bytes = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#334455' } }).png().toBuffer()
    await expect(validateImageReferenceBytes(bytes, getImageReferenceCapabilities('gpt-image-2')!)).resolves.toMatchObject({ width: 8193, height: 1 })
    await expect(validateGeminiReferenceBytes(bytes, resolveGeminiImageModel('gemini-nb-lite')!)).rejects.toMatchObject({ code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
  })
  it('separates binary input size from the Gemini inline JSON path', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } }).png().toBuffer()
    const bytes = Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024 - png.length)])
    await expect(validateImageReferenceBytes(bytes, getImageReferenceCapabilities('gpt-image-2')!)).resolves.toMatchObject({ mimeType: 'image/png' })
    await expect(validateGeminiReferenceBytes(bytes, resolveGeminiImageModel('gemini-nb-2.1')!)).rejects.toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
  })
})
