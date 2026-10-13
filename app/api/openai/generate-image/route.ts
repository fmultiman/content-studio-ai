import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { PROVIDER_CREDENTIAL_UNAVAILABLE, isProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import { freezeAndClaimImageAttempt, failImageAttempt, imageAttemptReplay, linkImageOutput, recordImageReferenceProvenance, ImageSubmissionError } from '@/lib/image-generation/execution'
import type { ImageGenerationAttemptRow } from '@/lib/image-generation/attempt'
import { ImageReferenceSchema, type ImageReference } from '@/lib/image-generation/session'
import { loadImageReferences, ImageReferenceError } from '@/lib/image-generation/reference-media'
import { resolveOpenAIImageEditModel } from '@/lib/providers/openai/image-models'
import { editOpenAIImage, OpenAIImageEditError, isOpenAIImageEditSize, isOpenAIImageEditQuality } from '@/lib/providers/openai/image-edit-client'
import { accountOpenAIImageEditUsage } from '@/lib/usage/openai-image-usage'

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const ALLOWED_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
])

const RAW_REFERENCE_FIELD = /image|img|photo|picture|reference|source|mask|inline|file|attach|upload|media|^url$|^dataUrl$/i
function validateEditControls(size: unknown, quality: unknown) {
  if (!isOpenAIImageEditSize(size)) throw new ImageSubmissionError(400, 'INVALID_IMAGE_SIZE', 'Tamanho de edição inválido.')
  if (!isOpenAIImageEditQuality(quality)) throw new ImageSubmissionError(400, 'INVALID_IMAGE_QUALITY', 'Qualidade de edição inválida.')
}

// Isolated edit lifecycle. The generation branches below keep their original request/output handling.
async function runCanonicalOpenAIEdit(input: {
  supabase: Awaited<ReturnType<typeof createClient>>; userId: string; sessionId: string
  prompt: string; model: string; size: string; quality: string
}, attempt: ImageGenerationAttemptRow, sourceReferences: ImageReference[]) {
  let providerAttempted = false
  try {
    const model = resolveOpenAIImageEditModel(input.model)
    if (!model) throw new ImageSubmissionError(400, 'SOURCE_NOT_SUPPORTED', 'Este modelo não aceita referências de imagem.')
    validateEditControls(input.size, input.quality)
    const references = await loadImageReferences({ db: input.supabase, userId: input.userId,
      projectId: attempt.project_id, references: sourceReferences, capabilities: model.referenceCapabilities })
    await recordImageReferenceProvenance(attempt, references.map((reference) => reference.provenance))
    const execution = await resolveProviderExecution(input.supabase, { userId: input.userId, provider: 'openai' })
    if (execution.status !== 'ready') throw new ImageSubmissionError(400, 'PROVIDER_NOT_CONFIGURED', 'API Key da OpenAI não configurada')
    const usageContext = (providerResponse: 'received' | 'received_rejected', responseId: string | null, rejectedAs?: string) => ({
      userId: input.userId, attemptId: attempt.id, projectId: attempt.project_id, productionId: attempt.production_id,
      model: input.model, size: input.size, quality: input.quality, funding: execution.executionMode,
      credentialSource: execution.credentialSource, inputReferences: references.map((reference) => reference.provenance),
      providerResponse, responseId, ...(rejectedAs ? { rejectedAs } : {}),
    })
    let generated: Awaited<ReturnType<typeof editOpenAIImage>>
    try {
      providerAttempted = true
      generated = await editOpenAIImage({ apiKey: execution.secret, prompt: input.prompt.trim(),
        size: input.size, quality: input.quality, referenceImage: references[0] })
    } catch (error) {
      if (error instanceof OpenAIImageEditError && error.received) {
        await accountOpenAIImageEditUsage(usageContext('received_rejected', error.received.responseId, error.code), error.received.rawUsage)
      }
      throw error
    }
    // Usage belongs to the paid execution even when output storage/linking subsequently fails.
    await accountOpenAIImageEditUsage(usageContext('received', generated.responseId), generated.rawUsage)
    let stored: Awaited<ReturnType<typeof uploadImageToS3>>
    try {
      stored = await uploadImageToS3({ userId: input.userId, folder: 'images', buffer: generated.bytes, mimeType: generated.mimeType })
    } catch { throw new ImageSubmissionError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível.') }
    if (!stored?.storagePath) throw new ImageSubmissionError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível.')
    const imageUrl = (await createPresignedReadUrl(stored.storagePath).catch(() => null)) || stored.imageUrl
    const image = await linkImageOutput(attempt, { imageUrl, publicUrl: stored.imageUrl, thumbnailUrl: stored.thumbnailUrl,
      storageProvider: stored.storageProvider, storagePath: stored.storagePath, thumbnailPath: stored.thumbnailPath,
      fileSize: stored.fileSize, mimeType: stored.mimeType })
    return { imageUrl, publicUrl: stored.imageUrl, thumbnailUrl: stored.thumbnailUrl, storageProvider: stored.storageProvider,
      storagePath: stored.storagePath, thumbnailPath: stored.thumbnailPath, fileSize: stored.fileSize, mimeType: stored.mimeType,
      provider: 'openai', model: input.model, attemptId: attempt.id, sessionId: input.sessionId, image, replayed: false }
  } catch (error) {
    const mapped = error instanceof OpenAIImageEditError || error instanceof ImageSubmissionError ? error
      : error instanceof ImageReferenceError ? new ImageSubmissionError(error.status, error.code, 'A referência não está disponível para edição.')
        : isProviderCredentialUnavailableError(error) ? new ImageSubmissionError(503, PROVIDER_CREDENTIAL_UNAVAILABLE, 'Não foi possível carregar a API Key da OpenAI.')
          : new ImageSubmissionError(500, 'GENERATION_FAILED', 'Não foi possível concluir a edição.')
    const outcomeUnknown = error instanceof OpenAIImageEditError ? error.outcomeUnknown : providerAttempted
    await failImageAttempt(attempt, mapped.message, outcomeUnknown).catch(() => undefined)
    throw new ImageSubmissionError(mapped.status, mapped.code, mapped.message, outcomeUnknown)
  }
}

async function runCanonicalOpenAI(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  sessionId: string
  clientRequestId: string
  prompt: string
  model: string
  size: string
  quality: string
  sourceReferences?: ImageReference[]
}) {
  let frozen
  let providerOutcomeUnknown = false
  try {
    frozen = await freezeAndClaimImageAttempt({
      userId: input.userId,
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
      prompt: input.prompt.trim(),
      provider: 'openai',
      model: input.model,
      config: { size: input.size, quality: input.quality },
      ...(input.sourceReferences !== undefined ? { sourceReferences: input.sourceReferences } : {}),
    })
    if (!frozen.claimed) return imageAttemptReplay(frozen.attempt)
    const references = (frozen.attempt.source_snapshot?.references ?? []) as ImageReference[]
    if (references.length) return await runCanonicalOpenAIEdit(input, frozen.attempt, references)

    const execution = await resolveProviderExecution(input.supabase, { userId: input.userId, provider: 'openai' })
    if (execution.status !== 'ready') {
      await failImageAttempt(frozen.attempt, 'API Key da OpenAI não configurada')
      throw new ImageSubmissionError(400, 'PROVIDER_NOT_CONFIGURED', 'API Key da OpenAI não configurada')
    }

    let response: Response
    try {
      providerOutcomeUnknown = true
      response = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${execution.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: input.model, prompt: input.prompt.trim(), size: input.size, quality: input.quality, n: 1 }),
      })
    } catch (error) {
      await failImageAttempt(frozen.attempt, error instanceof Error ? error.message : 'Falha de rede na OpenAI', true)
      throw new ImageSubmissionError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a geração na OpenAI.', true)
    }

    const responseText = await response.text()
    let data: { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } }
    try { data = JSON.parse(responseText) } catch {
      await failImageAttempt(frozen.attempt, 'Resposta inválida da OpenAI', true)
      throw new ImageSubmissionError(502, 'INVALID_PROVIDER_RESPONSE', 'Resposta inválida da OpenAI', true)
    }
    if (!response.ok) {
      const outcomeUnknown = response.status >= 500 || response.status === 408
      providerOutcomeUnknown = outcomeUnknown
      await failImageAttempt(frozen.attempt, data.error?.message || `Erro na OpenAI: ${response.status}`, outcomeUnknown)
      throw new ImageSubmissionError(response.status, 'PROVIDER_ERROR', data.error?.message || `Erro na OpenAI: ${response.status}`, outcomeUnknown)
    }

    const firstImage = data.data?.[0]
    const imageDataUrl = firstImage?.b64_json ? `data:image/png;base64,${firstImage.b64_json}` : firstImage?.url
    let imageUrl = imageDataUrl
    let storage: Awaited<ReturnType<typeof uploadImageToS3>> = null
    if (firstImage?.b64_json) {
      storage = await uploadImageToS3({ userId: input.userId, folder: 'images', dataUrl: imageDataUrl })
      if (storage) imageUrl = await createPresignedReadUrl(storage.storagePath) || storage.imageUrl
    }
    if (!imageUrl) {
      await failImageAttempt(frozen.attempt, 'A OpenAI não retornou uma imagem', true)
      throw new ImageSubmissionError(502, 'EMPTY_PROVIDER_RESULT', 'A OpenAI não retornou uma imagem', true)
    }
    const image = await linkImageOutput(frozen.attempt, {
      imageUrl,
      publicUrl: storage?.imageUrl || null,
      thumbnailUrl: storage?.thumbnailUrl || null,
      storageProvider: storage?.storageProvider || null,
      storagePath: storage?.storagePath || null,
      thumbnailPath: storage?.thumbnailPath || null,
      fileSize: storage?.fileSize || null,
      mimeType: storage?.mimeType || null,
    })
    return {
      imageUrl,
      publicUrl: storage?.imageUrl || null,
      thumbnailUrl: storage?.thumbnailUrl || null,
      storageProvider: storage?.storageProvider || null,
      storagePath: storage?.storagePath || null,
      thumbnailPath: storage?.thumbnailPath || null,
      fileSize: storage?.fileSize || null,
      mimeType: storage?.mimeType || null,
      provider: 'openai', model: input.model, attemptId: frozen.attempt.id, sessionId: input.sessionId,
      image, replayed: false,
    }
  } catch (error) {
    if (error instanceof ImageSubmissionError && !providerOutcomeUnknown) throw error
    try { if (frozen?.attempt) await failImageAttempt(frozen.attempt, error instanceof Error ? error.message : 'Falha na geração', providerOutcomeUnknown) } catch { /* preserve original error */ }
    if (error instanceof ImageSubmissionError) throw new ImageSubmissionError(error.status, error.code, error.message, true)
    // The credential store could not be read: a retryable pre-submission failure, not "not configured".
    if (isProviderCredentialUnavailableError(error)) throw new ImageSubmissionError(503, PROVIDER_CREDENTIAL_UNAVAILABLE, error.message)
    throw new ImageSubmissionError(500, 'GENERATION_FAILED', error instanceof Error ? error.message : 'Erro interno', providerOutcomeUnknown)
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // FUTURE-050: before the image Attempt is frozen/claimed and before any credential is read.
    const blocked = providerExecutionBlockedResponse({ provider: 'openai', operation: 'image_generation' })
    if (blocked) return blocked

    const requestBody = await request.json()
    const {
      prompt,
      model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
      size = '1024x1024',
      quality = 'medium',
      sessionId,
      clientRequestId,
      sourceReferences: rawReferences,
    } = requestBody

    // Raw media, URLs and masks are never accepted as references; only canonical durable IDs.
    const rawSource = Object.keys(requestBody).find((key) => key !== 'sourceReferences' && RAW_REFERENCE_FIELD.test(key) && !/size/i.test(key) && !['model', 'size', 'quality', 'sessionId', 'clientRequestId', 'prompt'].includes(key))
    if (rawSource) return NextResponse.json({ error: 'Use uma imagem ou arquivo salvo como referência.', code: 'SOURCE_NOT_SUPPORTED' }, { status: 400 })
    let sourceReferences: ImageReference[] | undefined
    if (rawReferences !== undefined) {
      if (!Array.isArray(rawReferences)) return NextResponse.json({ error: 'Referência inválida.', code: 'INVALID_SOURCE_REFERENCE' }, { status: 400 })
      if (rawReferences.length > 1) return NextResponse.json({ error: 'Use uma referência por geração.', code: 'SOURCE_REFERENCE_LIMIT' }, { status: 400 })
      const parsed = rawReferences.map((reference) => ImageReferenceSchema.safeParse(reference))
      if (parsed.some((reference) => !reference.success)) return NextResponse.json({ error: 'Use o identificador de uma imagem ou arquivo da Biblioteca.', code: 'INVALID_SOURCE_REFERENCE' }, { status: 400 })
      sourceReferences = parsed.map((reference) => reference.data!)
      if (sourceReferences.length && !resolveOpenAIImageEditModel(model)) return NextResponse.json({ error: 'Este modelo não aceita referências de imagem.', code: 'SOURCE_NOT_SUPPORTED' }, { status: 400 })
      if (typeof sessionId !== 'string' || typeof clientRequestId !== 'string') return NextResponse.json({ error: 'sessionId e clientRequestId são obrigatórios', code: 'SESSION_REQUEST_ID_REQUIRED' }, { status: 400 })
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt obrigatorio' }, { status: 400 })
    }

    if (!ALLOWED_IMAGE_MODELS.has(model)) {
      return NextResponse.json(
        { error: 'Modelo de imagem OpenAI invalido' },
        { status: 400 },
      )
    }

    if (sessionId || clientRequestId) {
      if (typeof sessionId !== 'string' || typeof clientRequestId !== 'string') {
        return NextResponse.json({ error: 'sessionId e clientRequestId são obrigatórios', code: 'SESSION_REQUEST_ID_REQUIRED' }, { status: 400 })
      }
      try {
        return NextResponse.json(await runCanonicalOpenAI({ supabase, userId: user.id, sessionId, clientRequestId, prompt, model, size, quality,
          ...(sourceReferences !== undefined ? { sourceReferences } : {}) }))
      } catch (error) {
        if (error instanceof ImageSubmissionError) return NextResponse.json({ error: error.message, code: error.code, outcome_unknown: error.outcomeUnknown }, { status: error.status })
        throw error
      }
    }

    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'openai' })

    if (execution.status !== 'ready') {
      return NextResponse.json(
        { error: 'API Key da OpenAI nao configurada', code: execution.code, provider: 'openai' },
        { status: 400 },
      )
    }
    const apiKey = execution.secret

    const response = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: prompt.trim(),
        size,
        quality,
        n: 1,
      }),
    })

    const responseText = await response.text()
    let data: {
      data?: Array<{ b64_json?: string; url?: string }>
      error?: { message?: string }
    }

    try {
      data = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        { error: 'Resposta invalida da OpenAI', details: responseText },
        { status: 502 },
      )
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || `Erro na OpenAI: ${response.status}`,
          details: data,
        },
        { status: response.status },
      )
    }

    const firstImage = data.data?.[0]
    const imageDataUrl = firstImage?.b64_json
      ? `data:image/png;base64,${firstImage.b64_json}`
      : firstImage?.url
    let imageUrl = imageDataUrl
    let storage: Awaited<ReturnType<typeof uploadImageToS3>> = null

    if (firstImage?.b64_json) {
      storage = await uploadImageToS3({
        userId: user.id,
        folder: 'images',
        dataUrl: imageDataUrl,
      })

      if (storage) {
        imageUrl = await createPresignedReadUrl(storage.storagePath) || storage.imageUrl
      }
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'A OpenAI nao retornou uma imagem', details: data },
        { status: 502 },
      )
    }

    return NextResponse.json({
      imageUrl,
      publicUrl: storage?.imageUrl || null,
      thumbnailUrl: storage?.thumbnailUrl || null,
      storageProvider: storage?.storageProvider || null,
      storagePath: storage?.storagePath || null,
      thumbnailPath: storage?.thumbnailPath || null,
      fileSize: storage?.fileSize || null,
      mimeType: storage?.mimeType || null,
      provider: 'openai',
      model,
    })
  } catch (error) {
    const credentialUnavailable = providerCredentialUnavailableResponse(error)
    if (credentialUnavailable) return credentialUnavailable
    console.error('[OpenAI Generate Image] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
