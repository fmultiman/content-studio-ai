// FUTURE-064 Slice A — official Google Gemini ("Nano Banana") image generation/editing, canonical Session/Attempt only.
//
// Shape follows the synchronous OpenAI route (the provider returns the image inline), NOT the NanoBananaAPI.ai
// submit/callback/poll flow (that is a different, third-party provider and is untouched).
//
// Order of operations, and why:
//   1. authenticate                      - nothing else is evaluated for an anonymous caller
//   2. release switch                    - disabled by default; nothing durable and no credential is touched
//   3. FUTURE-050 execution policy       - Preview/local/unknown runtimes never spend
//   4. validate the request              - closed schema, closed model registry, durable source identities
//   5. freezeAndClaimImageAttempt        - ownership, immutable snapshot, idempotency, exactly one Attempt per request
//   6. resolveProviderExecution(gemini)  - the existing Gemini BYOK resolver; missing vs unavailable stay distinct
//   7. ONE Gemini call, no retry         - failures close the Attempt; a retry is a new, explicit request
//   8. store the bytes, link the output  - a storage/link failure after the provider answered closes the Attempt
//
// Reported usage is recorded before storage; estimated prices and completeness are derived by the Usage page.
import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse, providerExecutionDisabledResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { PROVIDER_CREDENTIAL_UNAVAILABLE, isProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import { freezeAndClaimImageAttempt, failImageAttempt, imageAttemptReplay, linkImageOutput, recordImageReferenceProvenance, ImageSubmissionError } from '@/lib/image-generation/execution'
import type { ImageGenerationAttemptRow } from '@/lib/image-generation/attempt'
import { ImageReferenceSchema, type ImageReference } from '@/lib/image-generation/session'
import { ImageReferenceError, loadGeminiImageReferences } from '@/lib/image-generation/reference-media'
import { generateGeminiImage, isGeminiImageError, type GeminiImageError } from '@/lib/providers/gemini/image-client'
import { accountGeminiImageUsage, type GeminiImageUsageContext } from '@/lib/usage/gemini-image-usage'
import {
  GEMINI_IMAGE_ALIASES,
  GEMINI_IMAGE_MODEL_NOT_RELEASED,
  GEMINI_IMAGE_MODEL_NOT_RELEASED_MESSAGE,
  GEMINI_IMAGE_DEFAULT_ASPECT_RATIO,
  GEMINI_IMAGE_PROVIDER,
  GEMINI_IMAGE_SIZE,
  isGeminiImageAspectRatio,
  isGeminiImageReleasedModel,
  resolveGeminiImageModel,
  type GeminiImageModel,
} from '@/lib/providers/gemini/image-models'
import {
  GEMINI_IMAGE_GENERATION_DISABLED_CODE,
  isGeminiImageGenerationEnabled,
} from '@/lib/providers/gemini/image-feature'

const MAX_BODY_CHARS = 64 * 1024
const MAX_PROMPT_CHARS = 20_000
const ALLOWED_FIELDS = new Set(['prompt', 'model', 'aspectRatio', 'sessionId', 'clientRequestId', 'sourceReferences'])
// Only sourceReferences may identify an input. Raw images, URLs, masks and files are rejected.
const SOURCE_FIELD = /image|img|photo|picture|reference|source|mask|inline|file|attach|upload|media|video/i

class RequestRejected extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

type ValidRequest = { prompt: string; model: GeminiImageModel; aspectRatio: string; sessionId: string; clientRequestId: string; sourceReferences?: ImageReference[] }

async function parseRequest(request: Request): Promise<ValidRequest> {
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) throw new RequestRejected(413, 'REQUEST_TOO_LARGE', 'Pedido grande demais.')
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new RequestRejected(400, 'INVALID_JSON', 'Corpo da requisição inválido.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestRejected(400, 'INVALID_BODY', 'Corpo da requisição inválido.')
  const fields = body as Record<string, unknown>

  for (const key of Object.keys(fields)) {
    if (ALLOWED_FIELDS.has(key)) continue
    if (SOURCE_FIELD.test(key) && !/size/i.test(key)) {
      throw new RequestRejected(400, 'SOURCE_NOT_SUPPORTED', 'Este modelo ainda não aceita imagens de referência.')
    }
    throw new RequestRejected(400, 'UNSUPPORTED_FIELD', 'Parâmetro não suportado.')
  }

  const prompt = typeof fields.prompt === 'string' ? fields.prompt.trim() : ''
  if (!prompt) throw new RequestRejected(400, 'PROMPT_REQUIRED', 'Prompt obrigatório.')
  if (prompt.length > MAX_PROMPT_CHARS) throw new RequestRejected(400, 'PROMPT_TOO_LONG', 'Prompt longo demais.')

  // Closed registry, resolved here on the trusted server. No default, no fallback, no other provider.
  const model = resolveGeminiImageModel(fields.model)
  if (!model) {
    throw new RequestRejected(400, 'INVALID_IMAGE_MODEL', `Modelo de imagem Gemini inválido. Use um de: ${GEMINI_IMAGE_ALIASES.join(', ')}.`)
  }

  const aspectRatio = fields.aspectRatio === undefined ? GEMINI_IMAGE_DEFAULT_ASPECT_RATIO : fields.aspectRatio
  if (!isGeminiImageAspectRatio(aspectRatio) || !model.aspectRatios.includes(aspectRatio)) throw new RequestRejected(400, 'INVALID_ASPECT_RATIO', 'Proporção de imagem inválida.')

  let sourceReferences: ImageReference[] | undefined
  if (fields.sourceReferences !== undefined) {
    if (!Array.isArray(fields.sourceReferences)) throw new RequestRejected(400, 'INVALID_SOURCE_REFERENCE', 'Referência inválida.')
    if (fields.sourceReferences.length > model.referenceCapabilities.maxReferences) throw new RequestRejected(400, 'SOURCE_REFERENCE_LIMIT', 'Use uma referência por geração.')
    sourceReferences = fields.sourceReferences.map((reference) => {
      const parsed = ImageReferenceSchema.safeParse(reference)
      if (!parsed.success) throw new RequestRejected(400, 'INVALID_SOURCE_REFERENCE', 'Use o identificador de uma imagem ou arquivo da Biblioteca.')
      return parsed.data
    })
  }

  if (typeof fields.sessionId !== 'string' || typeof fields.clientRequestId !== 'string') {
    throw new RequestRejected(400, 'SESSION_REQUEST_ID_REQUIRED', 'sessionId e clientRequestId são obrigatórios')
  }
  return { prompt, model, aspectRatio, sessionId: fields.sessionId, clientRequestId: fields.clientRequestId, ...(sourceReferences !== undefined ? { sourceReferences } : {}) }
}

function submissionFailure(error: GeminiImageError): ImageSubmissionError {
  switch (error.kind) {
    case 'invalid_credential': return new ImageSubmissionError(400, 'PROVIDER_CREDENTIAL_REJECTED', 'O Google Gemini recusou a API Key configurada.')
    case 'rate_limited': return new ImageSubmissionError(429, 'PROVIDER_RATE_LIMITED', 'Limite ou cota do Google Gemini atingido. Tente novamente mais tarde.')
    case 'content_blocked': return new ImageSubmissionError(422, 'PROVIDER_CONTENT_BLOCKED', 'O Google Gemini bloqueou este conteúdo. Ajuste o prompt.')
    case 'unsupported_model': return new ImageSubmissionError(502, 'PROVIDER_MODEL_UNAVAILABLE', 'O modelo do Google Gemini não está disponível.')
    case 'timeout': return new ImageSubmissionError(504, 'PROVIDER_TIMEOUT', 'O Google Gemini demorou demais para responder.')
    case 'no_image': return new ImageSubmissionError(502, 'EMPTY_PROVIDER_RESULT', 'O Google Gemini não retornou uma imagem')
    case 'malformed_response':
    case 'invalid_image':
    case 'image_too_large': return new ImageSubmissionError(502, 'INVALID_PROVIDER_RESPONSE', 'Resposta inválida do Google Gemini')
    case 'invalid_request': return new ImageSubmissionError(502, 'PROVIDER_ERROR', 'O Google Gemini rejeitou o pedido.')
    default: return new ImageSubmissionError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a geração no Google Gemini.')
  }
}

async function runCanonicalGemini(input: ValidRequest & { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }) {
  let frozen: Awaited<ReturnType<typeof freezeAndClaimImageAttempt>> | undefined
  try {
    frozen = await freezeAndClaimImageAttempt({
      userId: input.userId,
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
      prompt: input.prompt,
      provider: GEMINI_IMAGE_PROVIDER,
      model: input.model.alias,
      ...(input.sourceReferences !== undefined ? { sourceReferences: input.sourceReferences } : {}),
      // Part of the idempotency fingerprint: a different size/ratio/provider model is a different request.
      config: { aspectRatio: input.aspectRatio, imageSize: GEMINI_IMAGE_SIZE, providerModel: input.model.providerModel },
    })
    if (!frozen.claimed) return imageAttemptReplay(frozen.attempt)
    const attempt: ImageGenerationAttemptRow = frozen.attempt

    // Load only after the exclusive claim. A replay never reads media or calls the provider again.
    let references: Awaited<ReturnType<typeof loadGeminiImageReferences>>
    try {
      references = await loadGeminiImageReferences({ db: input.supabase, userId: input.userId,
        projectId: attempt.project_id, references: (attempt.source_snapshot?.references ?? []) as ImageReference[], model: input.model })
      if (references.length) {
        await recordImageReferenceProvenance(attempt, references.map((reference) => reference.provenance))
      }
    } catch (error) {
      await failImageAttempt(attempt, 'Não foi possível validar a referência.', false)
      if (error instanceof ImageReferenceError) throw new ImageSubmissionError(error.status, error.code, error.message)
      throw error
    }

    const execution = await resolveProviderExecution(input.supabase, { userId: input.userId, provider: GEMINI_IMAGE_PROVIDER })
    if (execution.status !== 'ready') {
      await failImageAttempt(attempt, 'API Key do Google Gemini não configurada')
      throw new ImageSubmissionError(400, 'PROVIDER_NOT_CONFIGURED', 'API Key do Google Gemini não configurada')
    }

    // FUTURE-064 Slice C: usage accounting identity of this ONE provider execution (the canonical Attempt).
    const usageContext = (response: Pick<GeminiImageUsageContext, 'providerResponse' | 'rejectedAs' | 'responseId' | 'modelVersion'>): GeminiImageUsageContext => ({
      userId: input.userId,
      attemptId: attempt.id,
      projectId: attempt.project_id,
      productionId: attempt.production_id,
      modelAlias: input.model.alias,
      providerModel: input.model.providerModel,
      aspectRatio: input.aspectRatio,
      imageSize: GEMINI_IMAGE_SIZE,
      funding: execution.executionMode,
      credentialSource: execution.credentialSource,
      ...(references.length ? { inputReferences: references.map((reference) => reference.provenance) } : {}),
      ...response,
    })

    // Exactly one provider call. A failure closes the Attempt; the user decides whether to submit again.
    let generated: Awaited<ReturnType<typeof generateGeminiImage>>
    try {
      generated = await generateGeminiImage({
        apiKey: execution.secret,
        providerModel: input.model.providerModel,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        imageSize: GEMINI_IMAGE_SIZE,
        ...(references.length ? { referenceImages: references.map(({ bytes, mimeType }) => ({ bytes, mimeType })) } : {}),
      })
    } catch (error) {
      if (!isGeminiImageError(error)) throw error
      // Google answered (2xx) but no image could be kept: account for the usage it reported (or one unknown-usage event).
      // No response at all (network, timeout, HTTP error, unreadable body) => nothing to account; the Attempt carries outcome_unknown.
      if (error.received) {
        await accountGeminiImageUsage(
          usageContext({ providerResponse: 'received_rejected', rejectedAs: error.kind, responseId: error.received.responseId, modelVersion: error.received.modelVersion }),
          error.received.usage,
        )
      }
      await failImageAttempt(attempt, `Gemini image generation failed (${error.kind})`, error.outcomeUnknown)
      throw submissionFailure(error)
    }

    // The provider answered with a usable image: account for what Google reported BEFORE touching storage, so a storage or
    // link failure below can never lose the usage of a paid execution. Never throws; never calls the provider again.
    await accountGeminiImageUsage(
      usageContext({ providerResponse: 'received', responseId: generated.responseId, modelVersion: generated.modelVersion }),
      generated.usage,
    )

    // The provider answered. From here a failure means a paid image we could not keep: record it as such.
    let stored: Awaited<ReturnType<typeof uploadImageToS3>>
    try {
      stored = await uploadImageToS3({ userId: input.userId, folder: 'images', buffer: generated.bytes, mimeType: generated.mimeType })
    } catch {
      await failImageAttempt(attempt, 'Gemini image generated but storage failed', true)
      throw new ImageSubmissionError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível.')
    }
    if (!stored) {
      await failImageAttempt(attempt, 'Gemini image generated but storage is not configured', true)
      throw new ImageSubmissionError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível.')
    }

    const imageUrl = (await createPresignedReadUrl(stored.storagePath).catch(() => null)) || stored.imageUrl
    let image
    try {
      image = await linkImageOutput(attempt, {
        imageUrl,
        publicUrl: stored.imageUrl,
        thumbnailUrl: stored.thumbnailUrl,
        storageProvider: stored.storageProvider,
        storagePath: stored.storagePath,
        thumbnailPath: stored.thumbnailPath,
        fileSize: stored.fileSize,
        mimeType: stored.mimeType,
      })
    } catch (error) {
      await failImageAttempt(attempt, 'Gemini image stored but could not be linked', true).catch(() => undefined)
      throw error instanceof ImageSubmissionError ? error : new ImageSubmissionError(503, 'OUTPUT_SAVE_FAILED', 'Não foi possível salvar a imagem.')
    }

    return {
      imageUrl,
      publicUrl: stored.imageUrl,
      thumbnailUrl: stored.thumbnailUrl,
      storageProvider: stored.storageProvider,
      storagePath: stored.storagePath,
      thumbnailPath: stored.thumbnailPath,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      provider: GEMINI_IMAGE_PROVIDER,
      model: input.model.alias,
      providerModel: input.model.providerModel,
      attemptId: attempt.id,
      sessionId: input.sessionId,
      image,
      replayed: false,
    }
  } catch (error) {
    if (error instanceof ImageSubmissionError) throw error
    // A credential-store failure happens before any provider call (outcome known: nothing was sent).
    const preSubmission = isProviderCredentialUnavailableError(error)
    try { if (frozen?.attempt) await failImageAttempt(frozen.attempt, 'Falha na geração', !preSubmission) } catch { /* preserve original error */ }
    // The credential store could not be read: a retryable pre-submission failure, not "not configured".
    if (isProviderCredentialUnavailableError(error)) throw new ImageSubmissionError(503, PROVIDER_CREDENTIAL_UNAVAILABLE, error.message)
    throw new ImageSubmissionError(500, 'GENERATION_FAILED', 'Erro interno')
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    // Release switch: disabled by default. Checked before any durable state and before any credential is read.
    const globalEnabled = isGeminiImageGenerationEnabled()
    const disabled = () => NextResponse.json({ error: 'A geração de imagens com o Google Gemini ainda não está habilitada.', code: GEMINI_IMAGE_GENERATION_DISABLED_CODE }, { status: 403 })
    if (!globalEnabled) return disabled()
    // FUTURE-050: before the Attempt is frozen/claimed and before any credential is read.
    const blocked = providerExecutionBlockedResponse({ provider: GEMINI_IMAGE_PROVIDER, operation: 'image_generation' })
    if (blocked) return blocked

    let valid: ValidRequest
    try {
      valid = await parseRequest(request)
    } catch (error) {
      if (error instanceof RequestRejected) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
      throw error
    }

    // Before claim, credential lookup or provider execution, for every approved model.
    if (!isGeminiImageReleasedModel(valid.model.alias)) {
      return NextResponse.json({ error: GEMINI_IMAGE_MODEL_NOT_RELEASED_MESSAGE, code: GEMINI_IMAGE_MODEL_NOT_RELEASED }, { status: 403 })
    }

    try {
      return NextResponse.json(await runCanonicalGemini({ ...valid, supabase, userId: user.id }))
    } catch (error) {
      if (error instanceof ImageSubmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
      throw error
    }
  } catch (error) {
    const credentialUnavailable = providerCredentialUnavailableResponse(error)
    if (credentialUnavailable) return credentialUnavailable
    const disabled = providerExecutionDisabledResponse(error)
    if (disabled) return disabled
    // Never log the error object: it could carry request context. The class name is enough to triage.
    console.error('[Gemini Generate Image] Error:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
