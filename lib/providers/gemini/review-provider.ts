// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Official Gemini API as a Review execution provider (provider ID `gemini`).
// Transport policy (V1):
//
//   image  -> inline bytes in the model request
//   video  -> Files API: chunked resumable upload of a byte STREAM -> wait ACTIVE -> reference in model request
//             -> delete remote file (upload-per-execution, no persistent cache)
//
// The remote file is execution transport only. Canonical media stays in Content
// Studio storage and `media_artifacts` is never touched. Cleanup failure is
// reported as a warning and never changes the Review outcome. Native video
// only: no ffmpeg, no frame extraction.

import {
  ReviewProviderError,
  assertMediaSupported,
  capabilityForMedia,
  type AuthorizedReviewMedia,
  type ReviewExecutionCleanupWarning,
  type ReviewExecutionProvider,
  type ReviewExecutionRequest,
  type ReviewExecutionResponse,
} from '@/lib/reviews/execution-provider'
import { assertReviewMediaWithinLimits } from '@/lib/reviews/media-limits'
import { createGeminiClient, type GeminiClient, type GeminiContentPart, type GeminiRemoteFile } from './client'
import { assertGeminiModelSupports } from './review-models'

export function createGeminiReviewProvider(options: { client?: GeminiClient } = {}): ReviewExecutionProvider {
  const client = options.client ?? createGeminiClient()
  return {
    providerId: 'gemini',
    capabilities: new Set(['image_review', 'video_review'] as const),
    async execute(request: ReviewExecutionRequest): Promise<ReviewExecutionResponse> {
      if (!request.apiKey) throw new ReviewProviderError('missing_credential', 'Gemini API key is not configured.')
      // All guards run BEFORE any upload or paid model call.
      assertMediaSupported(this, request.media)
      for (const media of request.media) {
        assertGeminiModelSupports(request.model, capabilityForMedia(media.kind))
        assertReviewMediaWithinLimits(media)
      }
      if (request.media.filter((media) => media.kind === 'video').length > 1) {
        throw new ReviewProviderError('media_limit_exceeded', 'Only one video can be reviewed per execution.')
      }

      const warnings: ReviewExecutionCleanupWarning[] = []
      const uploaded: GeminiRemoteFile[] = []
      const cleanup = async () => {
        for (const file of uploaded) {
          try {
            await client.deleteFile({ apiKey: request.apiKey, name: file.name })
          } catch {
            warnings.push({ code: 'REMOTE_FILE_CLEANUP_FAILED', message: 'Gemini remote file could not be deleted; it expires automatically.', remoteFileId: file.name })
          }
        }
      }

      try {
        const parts: GeminiContentPart[] = [{ text: request.input }]
        for (const media of request.media) parts.push(await prepareMedia(media))
        const generated = await client.generateContent({
          apiKey: request.apiKey,
          model: request.model,
          systemInstruction: request.instructions,
          parts,
          responseSchema: request.responseSchema,
          timeoutMs: request.timeoutMs,
        })
        await cleanup()
        const remote = uploaded[0]
        return {
          rawText: generated.text,
          providerId: 'gemini',
          model: request.model,
          providerRequestId: generated.responseId,
          usage: generated.usage,
          remoteFile: remote ? { id: remote.name, expiresAt: remote.expirationTime, deleted: !warnings.length } : undefined,
          warnings,
        }
      } catch (error) {
        await cleanup()
        if (error instanceof ReviewProviderError) error.warnings = warnings
        throw error
      }

      async function prepareMedia(media: AuthorizedReviewMedia): Promise<GeminiContentPart> {
        if (media.kind === 'image') {
          const bytes = await media.load()
          return { inlineData: { mimeType: media.mimeType, data: Buffer.from(bytes).toString('base64') } }
        }
        // Video is streamed to the Files API in bounded chunks; it is never held whole in memory.
        if (!media.openStream) throw new ReviewProviderError('unsupported_capability', 'Video media must provide a byte stream.')
        const source = await media.openStream()
        // The declared length is what the upload protocol commits to; the stream enforces it byte for byte.
        let file: GeminiRemoteFile
        try {
          assertReviewMediaWithinLimits({ kind: 'video', byteSize: source.byteLength, durationMs: media.durationMs })
          file = await client.uploadFile({ apiKey: request.apiKey, mimeType: media.mimeType, byteLength: source.byteLength, chunks: source.chunks })
        } catch (error) {
          source.abort()
          throw error
        }
        uploaded.push(file)
        file = await client.waitForActiveFile({ apiKey: request.apiKey, file })
        uploaded[uploaded.length - 1] = file
        return { fileData: { mimeType: file.mimeType || media.mimeType, fileUri: file.uri } }
      }
    },
  }
}
