import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Usar service role para atualizar sem RLS (callback vem de fora)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(request: NextRequest) {
  console.log('[NanoBanana Callback] Recebendo...')
  
  try {
    const body = await request.json()
    console.log('[NanoBanana Callback] Body:', JSON.stringify(body))

    // Extrair dados - múltiplos formatos possíveis
    let taskId: string | null = null
    let imageUrl: string | null = null
    let status: string = 'completed'
    let errorMessage: string | null = null

    // Extrair taskId
    taskId = body.taskId || body.task_id || body.id || 
             body.data?.taskId || body.data?.task_id || body.data?.id

    // Extrair imageUrl - formato correto: body.data.info.resultImageUrl
    const possibleUrls = [
      body.data?.info?.resultImageUrl,  // Formato correto da NanoBanana
      body.data?.resultImageUrl,
      body.data?.imageUrl,
      body.data?.image_url,
      body.data?.url,
      body.imageUrl,
      body.image_url,
      body.url,
      body.result?.url,
      body.result?.imageUrl,
      Array.isArray(body.images) ? body.images[0] : null,
      Array.isArray(body.data?.images) ? body.data.images[0] : null,
      Array.isArray(body.output) ? body.output[0] : null,
    ]
    
    // Encontrar primeira URL válida (deve ser string)
    for (const url of possibleUrls) {
      if (typeof url === 'string' && url.length > 0) {
        imageUrl = url
        break
      }
    }

    // Verificar se é erro
    if (body.status === 'failed' || body.status === 'error' || body.error || body.code !== 200) {
      status = 'failed'
      errorMessage = body.error || body.message || body.msg || body.data?.error || 'Erro desconhecido'
    }

    console.log('[NanoBanana Callback] TaskId:', taskId)
    console.log('[NanoBanana Callback] ImageUrl:', typeof imageUrl === 'string' ? imageUrl.substring(0, 100) + '...' : imageUrl)
    console.log('[NanoBanana Callback] Status:', status)

    if (!taskId) {
      console.log('[NanoBanana Callback] TaskId não encontrado')
      return NextResponse.json({ error: 'TaskId não encontrado' }, { status: 400 })
    }

    // Validar imageUrl se status for completed
    if (status === 'completed' && typeof imageUrl !== 'string') {
      console.log('[NanoBanana Callback] resultImageUrl inválido ou ausente')
      status = 'failed'
      errorMessage = 'resultImageUrl inválido ou ausente'
    }

    // Cliente com service role (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Buscar task
    const { data: task, error: findError } = await supabase
      .from('generation_tasks')
      .select('id, user_id')
      .eq('task_id', taskId)
      .single()

    if (findError || !task) {
      console.log('[NanoBanana Callback] Task não encontrada:', taskId)
      return NextResponse.json({ error: 'Task não encontrada' }, { status: 404 })
    }

    console.log('[NanoBanana Callback] Task encontrada:', task.id)

    // Atualizar
    const updateData: Record<string, unknown> = {
      status,
      callback_received_at: new Date().toISOString(),
      raw_response: body,
    }

    if (imageUrl) updateData.image_url = imageUrl
    if (errorMessage) updateData.error_message = errorMessage

    const { error: updateError } = await supabase
      .from('generation_tasks')
      .update(updateData)
      .eq('id', task.id)

    if (updateError) {
      console.log('[NanoBanana Callback] Erro update:', updateError)
      return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 })
    }

    console.log('[NanoBanana Callback] Atualizado com sucesso')
    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[NanoBanana Callback] Erro:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'nanobanana-callback' })
}
