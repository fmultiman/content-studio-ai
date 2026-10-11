import { NextRequest, NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import {
  failImageAttempt,
  freezeAndClaimImageAttempt,
  imageAttemptReplay,
  markImageAttemptProcessing,
  ImageSubmissionError,
} from '@/lib/image-generation/execution'

const NANOBANANA_API_V1 = 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate'
const NANOBANANA_API_V2 = 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    // FUTURE-050: before the image Attempt is frozen/claimed and before any credential is read.
    const blocked = providerExecutionBlockedResponse({ provider: 'nano_banana', operation: 'image_generation' })
    if (blocked) return blocked

    const body = await request.json()
    const { prompt, aspectRatio = '1:1', projectId, model: requestModel, sessionId, clientRequestId } = body
    const model = requestModel || 'v1'
    if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt obrigatorio' }, { status: 400 })

    let canonicalAttempt: Awaited<ReturnType<typeof freezeAndClaimImageAttempt>> | null = null
    if (sessionId || clientRequestId) {
      if (typeof sessionId !== 'string' || typeof clientRequestId !== 'string') {
        return NextResponse.json({ error: 'sessionId e clientRequestId sao obrigatorios', code: 'SESSION_REQUEST_ID_REQUIRED' }, { status: 400 })
      }
      try {
        canonicalAttempt = await freezeAndClaimImageAttempt({
          userId: user.id,
          sessionId,
          clientRequestId,
          prompt: prompt.trim(),
          provider: 'nano_banana',
          model,
          config: { aspectRatio },
        })
        if (!canonicalAttempt.claimed) return NextResponse.json(await imageAttemptReplay(canonicalAttempt.attempt))
      } catch (error) {
        if (error instanceof ImageSubmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
        throw error
      }
    }

    let execution: Awaited<ReturnType<typeof resolveProviderExecution>>
    try {
      execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'nano_banana' })
    } catch (error) {
      const unavailable = providerCredentialUnavailableResponse(error)
      if (!unavailable) throw error
      // Pre-submission failure: no provider call was made, so the claimed Attempt is closed instead of left pending.
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'Credenciais do provedor indisponíveis')
      return unavailable
    }
    if (execution.status !== 'ready') {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'API Key do NanoBanana não configurada')
      return NextResponse.json({ error: 'API Key do NanoBanana não configurada', code: execution.code, provider: 'nano_banana', attemptId: canonicalAttempt?.attempt.id }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'NEXT_PUBLIC_APP_URL nao configurada')
      return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL nao configurada' }, { status: 500 })
    }
    const payload = {
      prompt: prompt.trim(),
      type: 'TEXTTOIAMGE',
      callBackUrl: `${appUrl}/api/nanobanana/callback`,
      numImages: 1,
      image_size: aspectRatio,
    }
    const apiUrl = model === 'v2' ? NANOBANANA_API_V2 : NANOBANANA_API_V1
    let response: Response
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${execution.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, error instanceof Error ? error.message : 'Falha de rede', true)
      throw error
    }
    const responseText = await response.text()
    if (!response.ok) {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, `Erro na API: ${response.status}`)
      return NextResponse.json({ error: `Erro na API: ${response.status}`, details: responseText }, { status: response.status })
    }

    let data: any
    try { data = JSON.parse(responseText) } catch {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'Resposta invalida da API', true)
      return NextResponse.json({ error: 'Resposta invalida da API' }, { status: 500 })
    }
    const taskId = data?.data?.taskId || data?.taskId || data?.id
    if (!taskId) {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'TaskId nao retornado pela API')
      return NextResponse.json({ error: 'TaskId nao retornado pela API', rawResponse: data }, { status: 500 })
    }

    const { data: task, error: insertError } = await supabase.from('generation_tasks').insert({
      user_id: user.id,
      project_id: canonicalAttempt?.session.project_id || projectId || null,
      task_id: taskId,
      provider: 'nanobanana',
      prompt: prompt.trim(),
      aspect_ratio: aspectRatio,
      status: 'processing',
      raw_response: data,
    }).select().single()
    if (insertError || !task) {
      if (canonicalAttempt) await failImageAttempt(canonicalAttempt.attempt, 'Erro ao salvar task', true)
      return NextResponse.json({ error: 'Erro ao salvar task' }, { status: 500 })
    }
    if (canonicalAttempt) await markImageAttemptProcessing(canonicalAttempt.attempt, task.id)
    return NextResponse.json({ success: true, taskId: task.id, externalTaskId: taskId, status: 'processing', attemptId: canonicalAttempt?.attempt.id || null })
  } catch (error) {
    console.error('[NanoBanana Generate] Erro:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro interno' }, { status: 500 })
  }
}
