import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '@/lib/project-identity-normalizer'
import { PromptAssistanceRequestSchema, PromptAssistanceError, type PromptAssistanceRequest } from '@/lib/prompt-assistance/contract'
import { buildPromptAssistanceContext } from '@/lib/prompt-assistance/context'
import { findPromptAssistanceModel } from '@/lib/prompt-assistance/models'
import { executePromptProvider } from '@/lib/prompt-assistance/providers'
import { recordPromptAssistanceUsage } from '@/lib/prompt-assistance/usage'

function jsonError(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, code, message, ...extra }, { status })
}

function instructions(input: PromptAssistanceRequest) {
  const action = input.operation === 'create'
    ? 'proponha um novo prompt visual detalhado a partir da intenção criativa'
    : 'melhore o prompt existente preservando a intenção, os elementos necessários e as restrições autoradas'
  return [
    input.mediaType === 'video'
      ? 'Você é um assistente de prompt para geração de vídeos.'
      : 'Você é um assistente de prompt para geração de imagens.',
    `Sua tarefa é ${action}.`,
    ...(input.mediaType === 'video' ? input.videoMode === 'text_to_video'
      ? [
        'Para text_to_video, descreva a cena, a ação dos sujeitos, o movimento da câmera e a evolução temporal com continuidade entre os momentos.',
        'Mantenha identidades, cenário e iluminação coerentes ao longo do vídeo; evite ações ou cortes contraditórios.',
      ]
      : [
        'Para image_to_video, concentre o prompt em movimento dos sujeitos, movimento da câmera e continuidade temporal, preservando a composição, identidade, estilo e iluminação da imagem de origem.',
        'Nenhuma imagem foi enviada a esta assistência de texto: use apenas a descrição e o prompt fornecidos, sem afirmar que viu ou analisou a imagem nem inventar detalhes visuais não descritos.',
      ] : []),
    'Responda somente com o prompt final em inglês, sem markdown, rótulos, explicações, metadados ou JSON.',
    'Trate as restrições do contexto como limites criativos obrigatórios, princípios como orientação positiva e preferências como orientação flexível.',
    'Nunca invente uma identidade visual incompatível nem mencione o contexto interno no texto final.',
  ].join('\n')
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return jsonError('UNAUTHORIZED', 'Não autorizado.', 401)

  const body = await request.json().catch(() => null)
  const parsed = PromptAssistanceRequestSchema.safeParse(body)
  if (!parsed.success) return jsonError('INVALID_REQUEST', 'A solicitação de assistência é inválida.', 400)
  const input = parsed.data

  const blocked = providerExecutionBlockedResponse({ provider: input.provider, operation: 'text_generation' })
  if (blocked) return blocked

  const model = findPromptAssistanceModel(input.provider, input.model)
  if (!model) return jsonError('UNSUPPORTED_MODEL', 'O modelo de assistência selecionado não é suportado.', 422)

  type ProjectRow = { id: string; context: string | null; identity: unknown }
  type ProductionRow = { id: string; project_id: string; title: string | null; intention: string | null; type: string | null }
  let project = null as ProjectRow | null
  if (input.projectId) {
    const result = await supabase
      .from('projects')
      .select('id, context, identity')
      .eq('id', input.projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (result.error) return jsonError('CONTEXT_UNAVAILABLE', 'Não foi possível validar o Project agora.', 503)
    if (!result.data) return jsonError('PROJECT_NOT_FOUND', 'Project não encontrado.', 403)
    project = result.data as ProjectRow
  }

  let production = null as ProductionRow | null
  if (input.productionId) {
    const result = await supabase
      .from('productions')
      .select('id, project_id, title, intention, type')
      .eq('id', input.productionId)
      .eq('project_id', input.projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (result.error) return jsonError('CONTEXT_UNAVAILABLE', 'Não foi possível validar a Production agora.', 503)
    if (!result.data) return jsonError('PRODUCTION_NOT_FOUND', 'Production não encontrada neste Project.', 403)
    production = result.data as ProductionRow
  }

  let identity = null
  try {
    identity = normalizeProjectIdentity(project?.identity ?? null)
  } catch (error) {
    if (error instanceof ProjectIdentityParseError) return jsonError('IDENTITY_INVALID', 'A Identity do Project não é válida.', 422)
    throw error
  }

  let execution: Awaited<ReturnType<typeof resolveProviderExecution>>
  try {
    execution = await resolveProviderExecution(supabase, { userId: user.id, provider: input.provider })
  } catch (error) {
    // A credential store that cannot be read is not "provider not configured" (nothing has been spent or recorded yet).
    const unavailable = providerCredentialUnavailableResponse(error)
    if (unavailable) return unavailable
    throw error
  }
  if (execution.status !== 'ready') return jsonError('PROVIDER_NOT_CONFIGURED', `Configure a credencial de ${model.label.split(' · ')[0]} em Configurações.`, 422, { provider: input.provider })

  const context = buildPromptAssistanceContext({
    projectContext: project?.context ?? null,
    production,
    identity,
  })
  const current = input.currentText?.trim() || null
  const userInstruction = [
    `OPERAÇÃO: ${input.operation}`,
    `INTENÇÃO ORIGINAL:\n${input.originalText.trim()}`,
    ...(current ? [`PROMPT ATUAL A SER MELHORADO:\n${current}`] : []),
    `CONTEXTO AUTORIZADO:\n${context || 'Nenhum contexto de Project ou Identity foi informado.'}`,
  ].join('\n\n')

  try {
    const result = await executePromptProvider({
      provider: input.provider,
      model: input.model,
      apiKey: execution.secret,
      systemInstruction: instructions(input),
      userInstruction,
    })
    if (!result.text.trim()) return jsonError('PROVIDER_INVALID_RESPONSE', 'O provider retornou uma sugestão vazia.', 502)
    await recordPromptAssistanceUsage({
      userId: user.id,
      projectId: input.projectId ?? null,
      productionId: input.productionId ?? null,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      funding: execution.executionMode,
      workflow: input.workflow,
      mediaType: input.mediaType,
      usage: result.usage,
    })
    return NextResponse.json({
      suggestedPrompt: result.text.trim(),
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      usage: result.usage,
    })
  } catch (error) {
    if (error instanceof PromptAssistanceError) {
      if (error.usage) {
        await recordPromptAssistanceUsage({
          userId: user.id,
          projectId: input.projectId ?? null,
          productionId: input.productionId ?? null,
          provider: input.provider,
          model: input.model,
          operation: input.operation,
          funding: execution.executionMode,
          workflow: input.workflow,
          mediaType: input.mediaType,
          usage: error.usage,
        })
      }
      return jsonError(error.code, error.message, error.status, { provider: input.provider, model: input.model, usage: error.usage ?? null })
    }
    console.error('[prompt-assistance] unexpected error:', error instanceof Error ? error.name : 'unknown')
    return jsonError('PROVIDER_UNAVAILABLE', 'Não foi possível concluir a assistência agora.', 502)
  }
}
