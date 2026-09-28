import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'

// NanoBanana API endpoints (dois A's: nanobanana + api)
const NANOBANANA_API_V1 = 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate'
const NANOBANANA_API_V2 = 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2'

export async function POST(request: NextRequest) {
  console.log('[NanoBanana Generate] Iniciando...')
  
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
    console.log('[NanoBanana Generate] User:', user.id)

    // Parse body first to get model from request
    const body = await request.json()
    const { prompt, aspectRatio = '1:1', projectId, model: requestModel } = body

    // Buscar API key (user_byok only — sem fallback de plataforma)
    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'nano_banana' })
    // Use model from request, fallback to v1
    const model = requestModel || 'v1'
    
    if (execution.status !== 'ready') {
      return NextResponse.json(
        { error: 'API Key do NanoBanana não configurada', code: execution.code, provider: 'nano_banana' },
        { status: 400 }
      )
    }
    const apiKey = execution.secret

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt obrigatório' }, { status: 400 })
    }
    console.log('[NanoBanana Generate] Prompt:', prompt.substring(0, 50))

    // Callback URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_APP_URL não configurada' },
        { status: 500 }
      )
    }
    const callBackUrl = `${appUrl}/api/nanobanana/callback`
    console.log('[NanoBanana Generate] Callback:', callBackUrl)

    // Payload
    const payload = {
      prompt: prompt.trim(),
      type: 'TEXTTOIAMGE',
      callBackUrl,
      numImages: 1,
      image_size: aspectRatio,
    }
    // Selecionar endpoint baseado no modelo
    const apiUrl = model === 'v2' ? NANOBANANA_API_V2 : NANOBANANA_API_V1
    console.log('[NanoBanana Generate] Model:', model)
    console.log('[NanoBanana Generate] API URL:', apiUrl)
    console.log('[NanoBanana Generate] Payload:', JSON.stringify(payload))

    // Chamar API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    console.log('[NanoBanana Generate] Status:', response.status)
    console.log('[NanoBanana Generate] Response:', responseText)

    if (!response.ok) {
      return NextResponse.json(
        { error: `Erro na API: ${response.status}`, details: responseText },
        { status: response.status }
      )
    }

    // Parse response
    let data
    try {
      data = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        { error: 'Resposta inválida da API' },
        { status: 500 }
      )
    }

    // Extrair taskId - formato: { code: 200, msg: "success", data: { taskId: "..." } }
    const taskId = data?.data?.taskId || data?.taskId || data?.id
    
    if (!taskId) {
      console.log('[NanoBanana Generate] Resposta sem taskId:', data)
      return NextResponse.json(
        { error: 'TaskId não retornado pela API', rawResponse: data },
        { status: 500 }
      )
    }
    console.log('[NanoBanana Generate] TaskId:', taskId)

    // Salvar task no banco
    const { data: task, error: insertError } = await supabase
      .from('generation_tasks')
      .insert({
        user_id: user.id,
        project_id: projectId || null,
        task_id: taskId,
        provider: 'nanobanana',
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        status: 'processing',
        raw_response: data,
      })
      .select()
      .single()

    if (insertError) {
      console.log('[NanoBanana Generate] Erro ao salvar:', insertError)
      return NextResponse.json(
        { error: 'Erro ao salvar task' },
        { status: 500 }
      )
    }
    console.log('[NanoBanana Generate] Task salva:', task.id)

    return NextResponse.json({
      success: true,
      taskId: task.id,
      externalTaskId: taskId,
      status: 'processing',
    })

  } catch (error) {
    console.error('[NanoBanana Generate] Erro:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
