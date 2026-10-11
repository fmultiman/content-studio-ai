import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { PROVIDER_CREDENTIAL_UNAVAILABLE, isProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import { freezeAndClaimImageAttempt, failImageAttempt, imageAttemptReplay, linkImageOutput, ImageSubmissionError } from '@/lib/image-generation/execution'

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const ALLOWED_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
])

async function runCanonicalOpenAI(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  sessionId: string
  clientRequestId: string
  prompt: string
  model: string
  size: string
  quality: string
}) {
  let frozen
  try {
    frozen = await freezeAndClaimImageAttempt({
      userId: input.userId,
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
      prompt: input.prompt.trim(),
      provider: 'openai',
      model: input.model,
      config: { size: input.size, quality: input.quality },
    })
    if (!frozen.claimed) return imageAttemptReplay(frozen.attempt)

    const execution = await resolveProviderExecution(input.supabase, { userId: input.userId, provider: 'openai' })
    if (execution.status !== 'ready') {
      await failImageAttempt(frozen.attempt, 'API Key da OpenAI não configurada')
      throw new ImageSubmissionError(400, 'PROVIDER_NOT_CONFIGURED', 'API Key da OpenAI não configurada')
    }

    let response: Response
    try {
      response = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${execution.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: input.model, prompt: input.prompt.trim(), size: input.size, quality: input.quality, n: 1 }),
      })
    } catch (error) {
      await failImageAttempt(frozen.attempt, error instanceof Error ? error.message : 'Falha de rede na OpenAI', true)
      throw new ImageSubmissionError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a geração na OpenAI.')
    }

    const responseText = await response.text()
    let data: { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } }
    try { data = JSON.parse(responseText) } catch {
      await failImageAttempt(frozen.attempt, 'Resposta inválida da OpenAI', true)
      throw new ImageSubmissionError(502, 'INVALID_PROVIDER_RESPONSE', 'Resposta inválida da OpenAI')
    }
    if (!response.ok) {
      await failImageAttempt(frozen.attempt, data.error?.message || `Erro na OpenAI: ${response.status}`)
      throw new ImageSubmissionError(response.status, 'PROVIDER_ERROR', data.error?.message || `Erro na OpenAI: ${response.status}`)
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
      await failImageAttempt(frozen.attempt, 'A OpenAI não retornou uma imagem')
      throw new ImageSubmissionError(502, 'EMPTY_PROVIDER_RESULT', 'A OpenAI não retornou uma imagem')
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
    if (error instanceof ImageSubmissionError) throw error
    try { if (frozen?.attempt) await failImageAttempt(frozen.attempt, error instanceof Error ? error.message : 'Falha na geração', true) } catch { /* preserve original error */ }
    // The credential store could not be read: a retryable pre-submission failure, not "not configured".
    if (isProviderCredentialUnavailableError(error)) throw new ImageSubmissionError(503, PROVIDER_CREDENTIAL_UNAVAILABLE, error.message)
    throw new ImageSubmissionError(500, 'GENERATION_FAILED', error instanceof Error ? error.message : 'Erro interno')
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

    const {
      prompt,
      model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
      size = '1024x1024',
      quality = 'medium',
      sessionId,
      clientRequestId,
    } = await request.json()

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
        return NextResponse.json(await runCanonicalOpenAI({ supabase, userId: user.id, sessionId, clientRequestId, prompt, model, size, quality }))
      } catch (error) {
        if (error instanceof ImageSubmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
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
