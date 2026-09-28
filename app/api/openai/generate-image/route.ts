import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const ALLOWED_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
])

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

    const {
      prompt,
      model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
      size = '1024x1024',
      quality = 'medium',
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
    console.error('[OpenAI Generate Image] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
